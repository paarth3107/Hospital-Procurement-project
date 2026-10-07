from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid, BidStatus
from app.models.facility import Facility
from app.models.product_master import ProcurementType, ProductMaster
from app.models.tender import Tender, TenderStatus
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound
from app.models.tender_invite import TenderInvite
from app.models.tender_line_exclusion import TenderLineExclusion
from app.models.vendor import Vendor, VendorStatus
from app.models.tender_line_item import TechnicalEvalMethod, TenderLineItem
from app.models.tender_attachment import TenderLineAttachment, TenderLineAttachmentKind
from app.services import document_store
from app.models.user_account import Role, UserAccount
from app.schemas.tender import (
    ApprovalPayload,
    ApprovalRoundOut,
    EligibleVendorOut,
    LineAttachmentOut,
    LineItemCreate,
    LineItemEligibilityOut,
    LineItemOut,
    RejectionPayload,
    TenderCreate,
    ExcludedVendorOut,
    GuestInviteCreate,
    VendorRemovalCreate,
    TenderInviteOut,
    TenderOut,
)
from app.security import get_current_user, require_role
from app.services.audit import changed, record, snapshot
from app.services.approval_matrix import MAX_ROUNDS_BEFORE_ESCALATION, can_approve_tier, escalate, resolve_required_tier
from app.services.eligibility import resolve_eligible_vendors
from app.services.open_links import facility_name, link_state, new_token
from app.services.ratings import rating_score

router = APIRouter(prefix="/api/v1/tenders", tags=["tenders"])

TENDER_AUTHORS = (Role.PROCUREMENT_OFFICER, Role.SYSTEM_ADMIN)


def _load_tender(tender_id: int, db: Session) -> Tender:
    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender not found")
    return tender


def _total_estimated_value(tender: Tender) -> float:
    """Spec §11.2 — the approval matrix resolves off the tender's total
    estimated value. A line item with no estimated price contributes 0 to
    the total (spec calls the field "reference only"; treating an unset
    reference price as a hard error would block drafting a tender before
    procurement has firmed up every line's budget number)."""

    return sum((li.estimated_price or 0.0) * li.qty for li in tender.line_items)


HEADER_KEYS = ("title", "department", "facility_id", "status", "bid_due_date", "tender_type")


def _audit_label(tender: Tender) -> str:
    return f"#{tender.id} {tender.title}"


def _validate_facility(facility_id: int | None, db: Session) -> None:
    """None is fine -- a Draft tolerates an unset facility (2026-10-01,
    user-directed); required only at submit (see the facility check in
    submit_for_approval). A facility_id that IS given but doesn't exist is
    still rejected here rather than reaching the INSERT as a dangling
    foreign key and crashing with a raw IntegrityError, same as an unknown
    catalog entry already gets in _validate_line_item."""

    if facility_id is not None and db.get(Facility, facility_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown facility")


@router.post("", response_model=TenderOut, status_code=status.HTTP_201_CREATED)
def create_tender(
    payload: TenderCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    _validate_facility(payload.facility_id, db)
    tender = Tender(**payload.model_dump(exclude={"line_items"}), created_by_id=user.id)
    if tender.open_tender:
        tender.open_link_token = new_token()
    db.add(tender)
    db.flush()
    _set_line_items(tender, payload.line_items, db)
    record(
        db, "tender.created", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        after={**snapshot(tender, HEADER_KEYS), "line_items": len(payload.line_items)},
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.get("", response_model=list[TenderOut])
def list_tenders(
    status_filter: TenderStatus | None = None,
    facility_id: int | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    query = db.query(Tender)
    if status_filter is not None:
        query = query.filter(Tender.status == status_filter)
    if facility_id is not None:
        query = query.filter(Tender.facility_id == facility_id)
    return query.order_by(Tender.created_at.desc()).all()


@router.get("/{tender_id}", response_model=TenderOut)
def get_tender(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    return _load_tender(tender_id, db)


def _require_draft(tender: Tender) -> None:
    if tender.status != TenderStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tender is in status '{tender.status.value}'; line items can only be edited while Draft",
        )


def _validate_line_item(payload: LineItemCreate, db: Session) -> None:
    product = db.get(ProductMaster, payload.product_master_id)
    if not product or not product.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    if product.procurement_type != payload.procurement_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Catalog entry #{product.id} is a '{product.procurement_type.value}', not '{payload.procurement_type.value}'",
        )


# Spec §9.4: a line's evaluation method (and its QCBS weights / Split-Award
# flag) is "fixed per line item at tender creation... cannot change after
# publish without a governed override" -- vendors are told upfront how
# they'll be evaluated.
LOCKED_EVAL_FIELDS = ("technical_eval_method", "technical_weight", "price_weight", "split_award_allowed")


def _check_evaluation_lock(tender: Tender, items: list[LineItemCreate], db: Session) -> None:
    """Once a tender has been approved/published at least once (invites were
    sent), refuses a Draft-edit that changes one of LOCKED_EVAL_FIELDS on a
    line that already existed then. Checked against approval-round history,
    not Tender.published_at -- withdraw_to_draft clears that field on every
    revert, but round history is permanent (spec §7.3: a round is never
    overwritten), so it survives a revert-then-edit the way this rule needs
    to. Matched by catalog entry rather than id -- deliberately, so removing
    a locked line and re-adding the same catalog entry as a "new" one doesn't
    dodge the lock either; there's no unapproved path around it, per spec §12."""

    ever_published = (
        db.query(TenderApprovalRound)
        .filter(TenderApprovalRound.tender_id == tender.id, TenderApprovalRound.decision == RoundDecision.APPROVED)
        .first()
        is not None
    )
    if not ever_published:
        return
    old_by_product = {li.product_master_id: li for li in tender.line_items}
    for item in items:
        old = old_by_product.get(item.product_master_id)
        if old is None or all(getattr(old, f) == getattr(item, f) for f in LOCKED_EVAL_FIELDS):
            continue
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"'{old.product.name}': the technical evaluation method, its QCBS weights, and Split-Award allowed "
                "can't change once this tender has been published -- vendors were already told how this line would "
                "be evaluated. Changing it needs a governed override (spec §12), which isn't built yet."
            ),
        )


def _set_line_items(tender: Tender, items: list[LineItemCreate], db: Session) -> None:
    """Replaces the tender's whole line-item list (Draft only -- callers
    check), matching incoming rows to existing ones by id (2026-10-01) rather
    than deleting and recreating every row: a line item can now carry
    attachments (app/models/tender_attachment.py), which are user-uploaded
    content, not derived data like TenderInvite -- wiping and reinserting the
    row on every save would cascade-delete them. A payload row with no id
    (or one that doesn't match) is a genuinely new line; an existing row
    whose id isn't in the payload was removed, and its invites/attachments
    cascade away with it as before."""

    for item in items:
        _validate_line_item(item, db)
    _check_evaluation_lock(tender, items, db)
    existing_by_id = {li.id: li for li in tender.line_items}
    keep_ids = set()
    for item in items:
        data = item.model_dump(exclude={"id"})
        existing = existing_by_id.get(item.id) if item.id is not None else None
        if existing is not None:
            for field, value in data.items():
                setattr(existing, field, value)
            keep_ids.add(existing.id)
        else:
            db.add(TenderLineItem(tender_id=tender.id, **data))
    for old_id, old in existing_by_id.items():
        if old_id not in keep_ids:
            db.delete(old)
    db.flush()
    db.expire(tender, ["line_items"])


@router.put("/{tender_id}", response_model=TenderOut)
def update_draft_tender(
    tender_id: int,
    payload: TenderCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """"Save as Draft" on an existing tender: every header field and the
    full line-item list are editable, but only while Draft."""

    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tender is in status '{tender.status.value}'; it can only be edited while Draft",
        )
    _validate_facility(payload.facility_id, db)
    header_keys = list(payload.model_dump(exclude={"line_items"}).keys())
    old = snapshot(tender, header_keys)
    old_lines = len(tender.line_items)
    was_open = tender.open_tender
    for field, value in payload.model_dump(exclude={"line_items"}).items():
        setattr(tender, field, value)
    if tender.open_tender and not was_open:
        tender.open_link_token = new_token()
    if not tender.open_tender:
        tender.open_link_token = None
    _set_line_items(tender, payload.line_items, db)
    before, after = changed(old, snapshot(tender, header_keys))
    if old_lines != len(payload.line_items):
        before["line_items"], after["line_items"] = old_lines, len(payload.line_items)
    record(db, "tender.updated", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id, before=before, after=after)
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/line-items", response_model=LineItemOut, status_code=status.HTTP_201_CREATED)
def add_line_item(
    tender_id: int,
    payload: LineItemCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = _load_tender(tender_id, db)
    _require_draft(tender)

    product = db.get(ProductMaster, payload.product_master_id)
    if not product or not product.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    if product.procurement_type != payload.procurement_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Catalog entry #{product.id} is a '{product.procurement_type.value}', not '{payload.procurement_type.value}'",
        )

    line_item = TenderLineItem(tender_id=tender_id, **payload.model_dump(exclude={"id"}))
    db.add(line_item)
    db.flush()
    record(
        db, "tender.line_item_added", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        after={"line_item_id": line_item.id, "product": product.name, "qty": line_item.qty},
    )
    db.commit()
    db.refresh(line_item)
    return line_item


@router.get("/{tender_id}/line-items", response_model=list[LineItemOut])
def list_line_items(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    _load_tender(tender_id, db)
    # Ordered by id (2026-10-01): _set_line_items only ever updates an
    # existing row in place or appends a new one, never inserts into the
    # middle, so id-ascending is the same order the grid had them in --
    # needed so the frontend's row-index bookkeeping (which Details panel is
    # open, mid-attaching a document) still points at the right row after a
    # save-triggered refresh.
    return db.query(TenderLineItem).filter(TenderLineItem.tender_id == tender_id).order_by(TenderLineItem.id).all()


def _load_line_item(tender_id: int, line_item_id: int, db: Session) -> TenderLineItem:
    line = db.get(TenderLineItem, line_item_id)
    if not line or line.tender_id != tender_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender line item not found")
    return line


def _load_attachment(line: TenderLineItem, attachment_id: int) -> TenderLineAttachment:
    att = next((a for a in line.attachments if a.id == attachment_id), None)
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return att


@router.post("/{tender_id}/line-items/{line_item_id}/attachments", response_model=LineAttachmentOut, status_code=status.HTTP_201_CREATED)
async def add_line_attachment(
    tender_id: int,
    line_item_id: int,
    kind: TenderLineAttachmentKind = Form(...),
    custom_label: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Spec §6.4 line-item attachments -- SOW document (Service), technical
    spec sheet (Asset), engineering drawing, reference/sample image. Only
    while the tender is Draft, same as the line items themselves."""

    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    line = _load_line_item(tender_id, line_item_id, db)

    content = await file.read()
    try:
        document_store.validate(file.content_type or "", len(content), allow_office=True)
    except document_store.DocumentValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    document_store.scan(content)

    att = TenderLineAttachment(
        tender_line_item_id=line.id,
        kind=kind,
        custom_label=(custom_label or "").strip() or None,
        original_filename=file.filename,
        content_type=file.content_type,
        size_bytes=len(content),
        content=content,
        uploaded_by_id=user.id,
    )
    db.add(att)
    db.flush()
    record(
        db, "tender.line_attachment_added", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        meta={"line_item_id": line.id, "kind": kind.value, "filename": file.filename},
    )
    db.commit()
    db.refresh(att)
    return att


@router.delete("/{tender_id}/line-items/{line_item_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_line_attachment(
    tender_id: int,
    line_item_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    line = _load_line_item(tender_id, line_item_id, db)
    att = _load_attachment(line, attachment_id)
    kind, filename = att.kind, att.original_filename
    db.delete(att)
    db.flush()
    record(
        db, "tender.line_attachment_removed", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        meta={"line_item_id": line.id, "kind": kind.value, "filename": filename},
    )
    db.commit()


@router.get("/{tender_id}/line-items/{line_item_id}/attachments/{attachment_id}/download")
def download_line_attachment(
    tender_id: int,
    line_item_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    line = _load_line_item(tender_id, line_item_id, db)
    att = _load_attachment(line, attachment_id)
    return Response(content=att.content, media_type=att.content_type, headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'})


@router.get("/{tender_id}/eligibility-preview", response_model=list[LineItemEligibilityOut])
def eligibility_preview(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    """Spec §6.5 — computed on demand, doesn't persist anything. Guest invites are
    the saved officer decisions and show with their reason. Vendors the officer
    removed are listed separately with their reason."""

    tender = _load_tender(tender_id, db)
    source = "open" if tender.open_tender else "system"
    results = []
    for li in tender.line_items:
        threshold = li.min_rating_threshold_override if li.min_rating_threshold_override is not None else tender.min_rating_threshold
        guests = {
            g.vendor_id: g
            for g in db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == li.id, TenderInvite.source == "guest").all()
        }
        exclusions = db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == li.id).all()
        excluded_ids = {x.vendor_id for x in exclusions}
        eligible = [
            EligibleVendorOut(vendor_id=e.vendor.id, legal_name=e.vendor.legal_name, rating_score=e.rating_score, source=source)
            for e in resolve_eligible_vendors(li, db)
            if e.vendor.id not in guests and e.vendor.id not in excluded_ids
        ]
        eligible += [
            EligibleVendorOut(vendor_id=g.vendor.id, legal_name=g.vendor.legal_name, rating_score=g.rating_at_resolution, source="guest", reason=g.reason)
            for g in guests.values()
        ]
        removed = [ExcludedVendorOut(vendor_id=x.vendor_id, legal_name=db.get(Vendor, x.vendor_id).legal_name, reason=x.reason) for x in exclusions]
        results.append(
            LineItemEligibilityOut(
                line_item_id=li.id,
                product_name=li.product.name,
                product_master_id=li.product_master_id,
                threshold_applied=threshold,
                eligible_vendors=eligible,
                removed_vendors=removed,
            )
        )
    return results


def _resolve_line(li: TenderLineItem, source: str, db: Session) -> tuple[bool, dict]:
    """Recomputes one line's invites. A guest invite survives while its vendor is
    Active, and a vendor the officer removed stays out. Returns whether the line
    ended with no invite at all, and the resolution record for audit."""

    guests = db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == li.id, TenderInvite.source == "guest").all()
    for guest in guests:
        if guest.vendor.status != VendorStatus.ACTIVE:
            db.delete(guest)
    db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == li.id, TenderInvite.source != "guest").delete(synchronize_session=False)
    invited = {g.vendor_id for g in guests if g.vendor.status == VendorStatus.ACTIVE}
    removed = {x.vendor_id for x in db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == li.id).all()}
    eligible = [e for e in resolve_eligible_vendors(li, db) if e.vendor.id not in invited and e.vendor.id not in removed]
    for e in eligible:
        db.add(TenderInvite(tender_line_item_id=li.id, vendor_id=e.vendor.id, source=source, rating_at_resolution=e.rating_score))
    db.flush()
    entry = {
        "line_item_id": li.id,
        "product": li.product.name,
        "eligible": [{"vendor_id": e.vendor.id, "vendor": e.vendor.legal_name, "rating": e.rating_score} for e in eligible],
        "guests": [{"vendor_id": g.vendor_id, "reason": g.reason} for g in guests if g.vendor_id in invited],
    }
    return (not invited and not eligible), entry


def _persist_invites(tender: Tender, db: Session) -> list[str]:
    """Recomputes the invite list for every line. Returns the names of lines
    left with no invite at all. Spec 6.5 blocks only a tender where no line has
    one, so a held-back line doesn't block the others."""

    source = "open" if tender.open_tender else "system"
    zero_eligible: list[str] = []
    resolution: list[dict] = []  # spec 6.5: the computation is kept as an audit record
    for li in tender.line_items:
        no_invite, entry = _resolve_line(li, source, db)
        resolution.append(entry)
        if no_invite:
            zero_eligible.append(li.product.name)
    return zero_eligible, resolution


def _line_of(tender: Tender, line_item_id: int) -> TenderLineItem:
    line = next((li for li in tender.line_items if li.id == line_item_id), None)
    if line is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found on this tender")
    return line


@router.post("/{tender_id}/open-link/regenerate", response_model=TenderOut)
def regenerate_open_link(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """A new link; the old one stops working at once."""

    tender = _load_tender(tender_id, db)
    if not tender.open_tender:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an Open Tender has a registration link")
    tender.open_link_token = new_token()
    record(db, "tender.open_link_regenerated", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id)
    db.commit()
    db.refresh(tender)
    return tender


@router.delete("/{tender_id}/open-link", response_model=TenderOut)
def disable_open_link(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Turns the registration link off. The tender stays an Open Tender; only
    the link goes. Regenerating brings a link back."""

    tender = _load_tender(tender_id, db)
    tender.open_link_token = None
    record(db, "tender.open_link_disabled", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id)
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/lines/{line_item_id}/guest-invites", response_model=TenderInviteOut, status_code=status.HTTP_201_CREATED)
def add_guest_invite(
    tender_id: int,
    line_item_id: int,
    payload: GuestInviteCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Officer invites an Active vendor the rules didn't select, with a reason
    (2026-10-06). Only while Draft, and never on an Open Tender (which already
    invites every Active vendor)."""

    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    if tender.open_tender:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An Open Tender already invites every Active vendor")
    line = _line_of(tender, line_item_id)
    vendor = db.get(Vendor, payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    if vendor.status != VendorStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only Active, approved vendors can be invited")
    if db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id, TenderInvite.vendor_id == vendor.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This vendor is already invited to this line")
    invite = TenderInvite(
        tender_line_item_id=line.id,
        vendor_id=vendor.id,
        source="guest",
        reason=payload.reason,
        rating_at_resolution=rating_score(vendor.id, line.procurement_type, db),
    )
    db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == line.id, TenderLineExclusion.vendor_id == vendor.id).delete(
        synchronize_session=False
    )
    db.add(invite)
    record(
        db, "tender.guest_invited", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        after={"line_item_id": line.id, "vendor_id": vendor.id, "vendor": vendor.legal_name}, reason=payload.reason,
    )
    db.commit()
    db.refresh(invite)
    return invite


@router.post("/{tender_id}/lines/{line_item_id}/vendor-removals", status_code=status.HTTP_204_NO_CONTENT)
def remove_vendors_from_line(
    tender_id: int,
    line_item_id: int,
    payload: VendorRemovalCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Takes one or more vendors off a line, whether the rules or the officer put
    them there, and keeps them off through recalculation. One reason covers the
    whole selection (2026-10-06). All or nothing: any unknown vendor refuses the
    lot. Not on an Open Tender, which invites every Active vendor by definition."""

    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    if tender.open_tender:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An Open Tender invites every Active vendor; turn Open tender off to change the list")
    line = _line_of(tender, line_item_id)
    vendors = [db.get(Vendor, vid) for vid in payload.vendor_ids]
    if any(v is None for v in vendors):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One of the vendors was not found")
    for vendor in vendors:
        db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id, TenderInvite.vendor_id == vendor.id).delete(synchronize_session=False)
        existing = db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == line.id, TenderLineExclusion.vendor_id == vendor.id).first()
        if existing is None:
            db.add(TenderLineExclusion(tender_line_item_id=line.id, vendor_id=vendor.id, reason=payload.reason))
        else:
            existing.reason = payload.reason
        record(
            db, "tender.vendor_removed", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
            after={"line_item_id": line.id, "vendor_id": vendor.id, "vendor": vendor.legal_name}, reason=payload.reason,
        )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{tender_id}/lines/{line_item_id}/vendor-removals/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
def restore_vendor_on_line(
    tender_id: int,
    line_item_id: int,
    vendor_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Undoes a removal: the rules decide again for this vendor on this line."""

    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    line = _line_of(tender, line_item_id)
    exclusion = db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == line.id, TenderLineExclusion.vendor_id == vendor_id).first()
    if exclusion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This vendor isn't removed from this line")
    db.delete(exclusion)
    db.flush()
    _resolve_line(line, "open" if tender.open_tender else "system", db)
    record(
        db, "tender.vendor_restored", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        before={"line_item_id": line.id, "vendor_id": vendor_id, "reason": exclusion.reason},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{tender_id}/submit-for-approval", response_model=TenderOut)
def submit_for_approval(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = _load_tender(tender_id, db)
    _require_draft(tender)

    # facility_id/title are optional while Draft (2026-10-01, user-directed)
    # but genuinely required from here on: the approval matrix is resolved
    # per facility, and the PO data file (spec §10.4) carries a facility/
    # entity code -- neither can proceed with a null one.
    if not tender.facility_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Facility must be set before submission")
    if not tender.title or not tender.title.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title must be set before submission")
    if not tender.line_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A tender needs at least one line item before submission")
    if not tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bid Due Date must be set before submission")
    if tender.is_rate_contract and (not tender.contract_start_date or not tender.contract_end_date):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contract start and end dates must be set before submission")

    # qty/QCBS-weights are optional at draft-save time (schemas/tender.py) so
    # a line can be saved -- and have documents attached -- as soon as it
    # identifies a catalog entry; genuinely required only from here on, same
    # split as facility_id/title above.
    for li in tender.line_items:
        if not li.qty or li.qty <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line item '{li.product.name}' needs a quantity greater than zero before submission",
            )
        if li.technical_eval_method == TechnicalEvalMethod.QCBS and (
            not li.technical_weight or li.technical_weight <= 0 or not li.price_weight or li.price_weight <= 0
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line item '{li.product.name}' (QCBS) needs both a technical weight and a price weight before submission",
            )

    # Spec §6.3.5/§6.4/§6.4.1: "a Service line cannot be submitted for approval
    # without a Scope of Work" -- an attached SOW_DOCUMENT on that specific
    # tender line, not the catalog entry (2026-10-01, user-directed: two
    # Service lines in the same tender can need two entirely different SOWs,
    # so this can't be a fact about the catalog entry they share). The
    # catalog's sow_template (spec §4.2.1) is a non-binding starting point a
    # line's attachment can be drafted from, never what satisfies this gate.
    missing_sow = [
        li.product.name
        for li in tender.line_items
        if li.procurement_type == ProcurementType.SERVICE
        and not any(a.kind == TenderLineAttachmentKind.SOW_DOCUMENT for a in li.attachments)
    ]
    if missing_sow:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"These Service line(s) need an attached Scope of Work document before this tender can be submitted: {', '.join(missing_sow)}",
        )

    # A line with zero eligible vendors doesn't block the tender: it is held
    # back (not published) while the other lines proceed. Only a tender where
    # NO line has an eligible vendor is refused.
    zero_eligible, resolution = _persist_invites(tender, db)
    if len(zero_eligible) == len(tender.line_items):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No line item has an eligible vendor — relax the rating threshold or map more vendors before submitting",
        )

    total_value = _total_estimated_value(tender)
    escalated = tender.consecutive_rejections >= MAX_ROUNDS_BEFORE_ESCALATION
    resolved = resolve_required_tier(total_value, tender.facility_id, db)
    required_tier = escalate(resolved.tier) if escalated else resolved.tier

    tender.round_number += 1
    tender.status = TenderStatus.PENDING_APPROVAL
    db.add(
        TenderApprovalRound(
            tender_id=tender.id,
            round_number=tender.round_number,
            decision=RoundDecision.PENDING,
            required_tier=required_tier,
            submitted_by_id=user.id,
        )
    )
    label = _audit_label(tender)
    record(
        db, "tender.eligibility_resolved", "tender", tender.id, actor=user, entity_label=label, facility_id=tender.facility_id,
        after={"lines": resolution}, meta={"at": "submission", "round_number": tender.round_number},
    )
    record(
        db, "tender.submitted_for_approval", "tender", tender.id, actor=user, entity_label=label, facility_id=tender.facility_id,
        before={"status": TenderStatus.DRAFT}, after={"status": TenderStatus.PENDING_APPROVAL},
        meta={"round_number": tender.round_number, "required_tier": required_tier, "total_estimated_value": total_value, "escalated": escalated},
    )
    db.commit()
    db.refresh(tender)
    return tender


def _current_round(tender: Tender, db: Session) -> TenderApprovalRound:
    round_ = (
        db.query(TenderApprovalRound)
        .filter(TenderApprovalRound.tender_id == tender.id, TenderApprovalRound.round_number == tender.round_number)
        .first()
    )
    if not round_ or round_.decision != RoundDecision.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tender has no pending approval round")
    return round_


def _authorize_approver(user: UserAccount, required_tier: int) -> None:
    """Spec §11.2's illustrative bands, reframed onto this system's roles
    (CLAUDE.md open question 2 — exact bands/roles still to be finalized):
    tier 1 (<=Rs.1,00,000) to tier 3 all resolve to the Approving Authority; tier 2/3
    (Department Head, and Department Head + Finance/Management Committee)
    both resolve to the Approving Authority role, disambiguated by
    UserAccount.approval_tier since this system has one Approving Authority
    role, not three. The actual predicate lives in
    app/services/approval_matrix.py's can_approve_tier() so the Dashboard's
    "Pending Your Approval" list can use the exact same rule."""

    if not can_approve_tier(user, required_tier):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This tender requires an Approving Authority at tier {required_tier} or above",
        )


@router.post("/{tender_id}/approve", response_model=TenderOut)
def approve_tender(
    tender_id: int,
    payload: ApprovalPayload | None = None,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is in status '{tender.status.value}', not pending approval")

    round_ = _current_round(tender, db)
    _authorize_approver(user, round_.required_tier)

    # Spec §5.9 "approval-time re-check" — vendor/mapping/rating state may
    # have moved since submission.
    zero_eligible, resolution = _persist_invites(tender, db)
    if len(zero_eligible) == len(tender.line_items):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No line item has an eligible vendor any more — cannot approve as-is",
        )
    # Publish the lines that have invites; hold back the rest. (The session does
    # not autoflush, so push the freshly added invites before querying them.)
    db.flush()
    invited_line_ids = {
        row[0]
        for row in db.query(TenderInvite.tender_line_item_id)
        .filter(TenderInvite.tender_line_item_id.in_([li.id for li in tender.line_items]))
        .all()
    }
    for li in tender.line_items:
        li.published = li.id in invited_line_ids

    round_.decision = RoundDecision.APPROVED
    round_.comments = payload.comments if payload else None
    round_.reviewer_id = user.id
    round_.decided_at = datetime.now(timezone.utc)
    tender.status = TenderStatus.PUBLISHED
    tender.published_at = datetime.now(timezone.utc)
    tender.consecutive_rejections = 0
    label = _audit_label(tender)
    record(
        db, "tender.eligibility_resolved", "tender", tender.id, actor=user, entity_label=label, facility_id=tender.facility_id,
        after={"lines": resolution}, meta={"at": "approval", "round_number": round_.round_number},
    )
    record(
        db, "tender.approved", "tender", tender.id, actor=user, entity_label=label, facility_id=tender.facility_id,
        before={"status": TenderStatus.PENDING_APPROVAL}, after={"status": TenderStatus.PUBLISHED}, reason=payload.comments if payload else None,
        meta={
            "round_number": round_.round_number, "required_tier": round_.required_tier,
            "lines_published": len(invited_line_ids), "lines_held": len(tender.line_items) - len(invited_line_ids),
        },
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/reject", response_model=TenderOut)
def reject_tender(
    tender_id: int,
    payload: RejectionPayload,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is in status '{tender.status.value}', not pending approval")

    round_ = _current_round(tender, db)
    _authorize_approver(user, round_.required_tier)

    round_.decision = RoundDecision.REJECTED
    round_.reviewer_id = user.id
    round_.comments = payload.comments
    round_.decided_at = datetime.now(timezone.utc)
    tender.status = TenderStatus.DRAFT
    tender.consecutive_rejections += 1
    record(
        db, "tender.rejected", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        before={"status": TenderStatus.PENDING_APPROVAL}, after={"status": TenderStatus.DRAFT}, reason=payload.comments,
        meta={"round_number": round_.round_number, "required_tier": round_.required_tier, "consecutive_rejections": tender.consecutive_rejections},
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/withdraw-to-draft", response_model=TenderOut)
def withdraw_to_draft(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Lets a Published tender be pulled back to Draft for editing --
    line items can only be added/changed while Draft (see
    add_line_item/_require_draft above). Refused once any vendor has
    already bid on it: reopening line items after real bids exist would
    silently invalidate what those vendors bid against, with nothing here
    to notify them. A tender with no bids yet has nothing to protect, so
    it's a plain revert, not a governed override -- there's no separate
    approval step for undoing your own not-yet-acted-on publish."""

    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is in status '{tender.status.value}', not Published")

    line_item_ids = [li.id for li in tender.line_items]
    bid_count = db.query(Bid).filter(Bid.tender_line_item_id.in_(line_item_ids), Bid.status == BidStatus.SUBMITTED).count() if line_item_ids else 0
    if bid_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot revert to Draft: {bid_count} bid(s) have already been submitted against this tender",
        )

    tender.status = TenderStatus.DRAFT
    tender.published_at = None
    for li in tender.line_items:
        li.published = False
    record(
        db, "tender.withdrawn_to_draft", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        before={"status": TenderStatus.PUBLISHED}, after={"status": TenderStatus.DRAFT},
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/line-items/{line_item_id}/publish", response_model=LineItemOut)
def publish_held_line(
    tender_id: int,
    line_item_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Publishes a line that was held back at approval time (it had no
    eligible vendor then) once vendors qualify. The tender itself was already
    approved; only this line's eligibility is re-resolved."""

    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a Published tender can have a held line published")
    if tender.bid_due_date is not None and datetime.now(timezone.utc) > tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The bid deadline for this tender has passed")
    line = next((li for li in tender.line_items if li.id == line_item_id), None)
    if line is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found on this tender")
    if line.published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This line is already published")

    eligible = resolve_eligible_vendors(line, db)
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Still no eligible vendor for {line.product.name} — relax the rating threshold or map more vendors",
        )
    db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id).delete()
    for e in eligible:
        db.add(TenderInvite(tender_line_item_id=line.id, vendor_id=e.vendor.id, rating_at_resolution=e.rating_score))
    line.published = True
    record(
        db, "tender.line_published", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        before={"line_item_id": line.id, "published": False}, after={"line_item_id": line.id, "published": True, "product": line.product.name},
        meta={"eligible_vendors": [{"vendor_id": e.vendor.id, "vendor": e.vendor.legal_name} for e in eligible]},
    )
    db.commit()
    db.refresh(line)
    return line


@router.get("/{tender_id}/invites", response_model=list[TenderInviteOut])
def list_invites(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    """The persisted snapshot from the last submit/approve (spec §6.5:
    "what the Approving Authority reviews... and what actual publish
    notifies") — distinct from `eligibility-preview`, which recomputes live
    and can drift from this once vendor/mapping/rating state moves on."""

    tender = _load_tender(tender_id, db)
    line_item_ids = [li.id for li in tender.line_items]
    if not line_item_ids:
        return []
    return db.query(TenderInvite).filter(TenderInvite.tender_line_item_id.in_(line_item_ids)).all()


@router.get("/{tender_id}/approval-rounds", response_model=list[ApprovalRoundOut])
def list_approval_rounds(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    _load_tender(tender_id, db)
    return (
        db.query(TenderApprovalRound)
        .filter(TenderApprovalRound.tender_id == tender_id)
        .order_by(TenderApprovalRound.round_number)
        .all()
    )


@router.post("/{tender_id}/force-close-bidding", response_model=TenderOut)
def force_close_bidding(tender_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(Role.SYSTEM_ADMIN))):
    """TEMPORARY DEMO UTILITY -- not a spec feature (remove once no longer
    needed). Lets System Admin skip the wait for a published tender's real
    bid due date, so technical/commercial evaluation can be demoed without
    sitting through the actual window. Every "is bidding still open" check in
    the app (technical_evaluation.py's deadline_passed(), the vendor portal,
    etc.) reads Tender.bid_due_date directly, so moving it into the past is
    the one change that closes bidding everywhere at once -- no separate
    "force closed" flag to keep in sync."""

    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is '{tender.status.value}', not published")
    now = datetime.now(timezone.utc)
    if tender.bid_due_date is not None and tender.bid_due_date <= now:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bidding is already closed for this tender")
    before = {"bid_due_date": tender.bid_due_date}
    tender.bid_due_date = now - timedelta(seconds=1)
    record(
        db, "tender.bid_window_force_closed", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        before=before, after={"bid_due_date": tender.bid_due_date}, reason="Demo utility -- not a spec-backed action",
    )
    db.commit()
    db.refresh(tender)
    return tender
