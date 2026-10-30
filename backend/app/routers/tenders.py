from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid, BidStatus
from app.models.facility import Facility
from app.models.override import OverrideRequest, OverrideStatus, OverrideType
from app.models.product_master import ProcurementType, ProductMaster
from app.models.staff_notification import StaffNotification
from app.models.tender import Tender, TenderStatus
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound
from app.models.tender_invite import TenderInvite
from app.models.tender_line_exclusion import TenderLineExclusion
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_rating import VendorRating
from app.models.tender_line_item import TechnicalEvalMethod, TenderLineItem
from app.models.tender_attachment import TenderLineAttachment, TenderLineAttachmentKind
from app.services import document_store, overrides
from app.models.user_account import Role, UserAccount
from app.schemas.override import OverrideDecision, OverrideRejection
from app.schemas.tender import (
    ApprovalPayload,
    ApprovalRoundOut,
    DueDateExtensionRequest,
    EligibleVendorOut,
    LateSubmissionExceptionRequest,
    LineAttachmentOut,
    LineItemCreate,
    LineItemEligibilityOut,
    LineItemOut,
    RejectionPayload,
    TenderCreate,
    ExcludedVendorOut,
    ManualInviteCreate,
    VendorRemovalCreate,
    TenderInviteOut,
    TenderOut,
)
from app.security import get_current_user, require_role
from app.services.audit import changed, record, snapshot
from app.services.approval_matrix import MAX_ROUNDS_BEFORE_ESCALATION, can_approve_tier, escalate, resolve_required_tier
from app.services.eligibility import resolve_eligible_vendors
from app.services.notifier import notify_vendor
from app.services.guest_invite_links import facility_name, link_state, new_token
from app.services.ratings import rating_score_detail
from app.services.tender_publish import notify_due_date_extended, notify_invited_vendors, sweep_scheduled_publishes

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


def _notify_round_submitter(db: Session, tender: Tender, round_: TenderApprovalRound, kind: str, title: str, body: str) -> None:
    """Tells the Procurement Officer who submitted this round what happened
    to it (2026-10-29, user-directed: "no notification shown to procurement
    officer after the tender is rejected by the approving authority" --
    extended the same day to approval too). `submitted_by_id` is nullable
    (an older round, or one with no recorded submitter) -- nothing to
    notify in that case, not an error."""

    if not round_.submitted_by_id:
        return
    db.add(StaffNotification(user_id=round_.submitted_by_id, kind=kind, title=title, body=body, entity_type="tender", entity_id=tender.id))


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
        tender.guest_invite_token = new_token()
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
    sweep_scheduled_publishes(db)  # at the moment it matters: this is what "still Scheduled" claims are read from
    query = db.query(Tender)
    if status_filter is not None:
        query = query.filter(Tender.status == status_filter)
    if facility_id is not None:
        query = query.filter(Tender.facility_id == facility_id)
    return query.order_by(Tender.created_at.desc()).all()


@router.get("/{tender_id}", response_model=TenderOut)
def get_tender(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    sweep_scheduled_publishes(db)
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
    # Real bug, found 2026-10-16: nothing stopped the same catalog entry from
    # being added on more than one line item -- two rows for the same product
    # would each resolve their own eligibility/invites/bid form, which makes
    # no sense (there's no way for a vendor to know which one is "the" line
    # for that item). Backend-enforced, not just the frontend grid's own
    # check (CLAUDE.md: never trust client-provided state for a workflow/
    # data-integrity rule) -- _check_evaluation_lock below already assumed
    # at most one line per product (it keys a dict by product_master_id), so
    # this closes a real gap rather than adding a new assumption.
    seen_products: dict[int, int] = {}
    for position, item in enumerate(items, start=1):
        if item.product_master_id in seen_products:
            product = db.get(ProductMaster, item.product_master_id)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{product.name if product else item.product_master_id}' is used on more than one line item -- each catalog entry can only appear once per tender.",
            )
        seen_products[item.product_master_id] = position
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
    # Guest Invite no longer depends on Open Tender (2026-10-28,
    # user-directed, "unhook that") -- turning Open Tender on still
    # generates a token as a convenience if one doesn't already exist, but
    # turning it off no longer wipes out an existing Guest Invite link (it
    # used to, unconditionally, even one generated independently via
    # GuestInviteLinkBox's own "New Link" button).
    if tender.open_tender and not was_open and not tender.guest_invite_token:
        tender.guest_invite_token = new_token()
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
    return Response(
        content=att.content, media_type=att.content_type,
        headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'},
    )


@router.post("/{tender_id}/terms-document", response_model=TenderOut, status_code=status.HTTP_201_CREATED)
async def upload_terms_document(
    tender_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """The tender's Terms & Conditions document (2026-10-07, user-directed) --
    payment terms, delivery terms, penalty clauses, validity period, read from
    the actual document rather than typed in. Replaces whatever was uploaded
    before. Only while Draft, same as everything else about the tender header;
    required before submit-for-approval."""

    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    content = await file.read()
    try:
        document_store.validate(file.content_type or "", len(content), allow_word=True)
    except document_store.DocumentValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    document_store.scan(content)

    tender.terms_document_filename = file.filename
    tender.terms_document_content_type = file.content_type
    tender.terms_document_size = len(content)
    tender.terms_document_content = content
    tender.terms_document_uploaded_at = datetime.now(timezone.utc)
    tender.terms_document_uploaded_by_id = user.id
    record(
        db, "tender.terms_document_uploaded", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        meta={"filename": file.filename},
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.delete("/{tender_id}/terms-document", response_model=TenderOut)
def delete_terms_document(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    filename = tender.terms_document_filename
    tender.terms_document_filename = None
    tender.terms_document_content_type = None
    tender.terms_document_size = None
    tender.terms_document_content = None
    tender.terms_document_uploaded_at = None
    tender.terms_document_uploaded_by_id = None
    record(
        db, "tender.terms_document_removed", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        meta={"filename": filename},
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.get("/{tender_id}/terms-document/download")
def download_terms_document(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    tender = _load_tender(tender_id, db)
    if not tender.terms_document_content:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Terms & Conditions document uploaded")
    return Response(
        content=tender.terms_document_content, media_type=tender.terms_document_content_type,
        headers={"Content-Disposition": f'inline; filename="{tender.terms_document_filename}"'},
    )


@router.post("/{tender_id}/rate-contract-document", response_model=TenderOut, status_code=status.HTTP_201_CREATED)
async def upload_rate_contract_document(
    tender_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """The signed Rate Contract agreement (2026-10-07, user-directed) -- only
    meaningful on a tender flagged is_rate_contract. Same single-document
    pattern as terms-document above: replaces whatever was uploaded before,
    only while Draft, required before submit-for-approval."""

    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    if not tender.is_rate_contract:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This tender isn't flagged as a rate contract")
    content = await file.read()
    try:
        document_store.validate(file.content_type or "", len(content), allow_word=True)
    except document_store.DocumentValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    document_store.scan(content)

    tender.rate_contract_document_filename = file.filename
    tender.rate_contract_document_content_type = file.content_type
    tender.rate_contract_document_size = len(content)
    tender.rate_contract_document_content = content
    tender.rate_contract_document_uploaded_at = datetime.now(timezone.utc)
    tender.rate_contract_document_uploaded_by_id = user.id
    record(
        db, "tender.rate_contract_document_uploaded", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        meta={"filename": file.filename},
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.delete("/{tender_id}/rate-contract-document", response_model=TenderOut)
def delete_rate_contract_document(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = _load_tender(tender_id, db)
    _require_draft(tender)
    filename = tender.rate_contract_document_filename
    tender.rate_contract_document_filename = None
    tender.rate_contract_document_content_type = None
    tender.rate_contract_document_size = None
    tender.rate_contract_document_content = None
    tender.rate_contract_document_uploaded_at = None
    tender.rate_contract_document_uploaded_by_id = None
    record(
        db, "tender.rate_contract_document_removed", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        meta={"filename": filename},
    )
    db.commit()
    db.refresh(tender)
    return tender


@router.get("/{tender_id}/rate-contract-document/download")
def download_rate_contract_document(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    tender = _load_tender(tender_id, db)
    if not tender.rate_contract_document_content:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Rate Contract agreement uploaded")
    return Response(
        content=tender.rate_contract_document_content, media_type=tender.rate_contract_document_content_type,
        headers={"Content-Disposition": f'inline; filename="{tender.rate_contract_document_filename}"'},
    )


@router.get("/{tender_id}/eligibility-preview", response_model=list[LineItemEligibilityOut])
def eligibility_preview(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    """Spec §6.5 — computed on demand, doesn't persist anything. Manual
    invites (§6.6) are the saved officer decisions and show with their
    reason. Vendors the officer removed are listed separately with their
    reason."""

    tender = _load_tender(tender_id, db)
    source = "open" if tender.open_tender else "system"
    # Batched (2026-10-13, performance): this used to run two queries
    # (manual invites, exclusions) per line item -- one query of each for
    # the whole tender replaces what used to be 2 x N.
    line_ids = [li.id for li in tender.line_items]
    manual_invites_by_line: dict[int, dict[int, TenderInvite]] = {}
    if line_ids:
        for g in db.query(TenderInvite).filter(TenderInvite.tender_line_item_id.in_(line_ids), TenderInvite.source == "manual").all():
            manual_invites_by_line.setdefault(g.tender_line_item_id, {})[g.vendor_id] = g
    exclusions_by_line: dict[int, list[TenderLineExclusion]] = {}
    all_excluded_vendor_ids: set[int] = set()
    if line_ids:
        for x in db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id.in_(line_ids)).all():
            exclusions_by_line.setdefault(x.tender_line_item_id, []).append(x)
            all_excluded_vendor_ids.add(x.vendor_id)
    excluded_vendor_names = {
        v.id: v.legal_name for v in (db.query(Vendor).filter(Vendor.id.in_(all_excluded_vendor_ids)).all() if all_excluded_vendor_ids else [])
    }

    # For the Manual Invite picker (2026-10-23, user-directed): its candidate
    # list is every Active vendor, not just this line's resolved
    # eligible_vendors -- that's the whole point of manual invite, reaching
    # vendors the automatic rules didn't select. One batched query per
    # procurement_type actually used on this tender, not one query per
    # (line, vendor), to stay in line with this endpoint's existing
    # batching above.
    active_vendor_ids = [vid for (vid,) in db.query(Vendor.id).filter(Vendor.status == VendorStatus.ACTIVE).all()]
    procurement_types = {li.procurement_type for li in tender.line_items}
    unrated_by_type: dict[ProcurementType, set[int]] = {}
    if active_vendor_ids and procurement_types:
        rated_by_type: dict[ProcurementType, set[int]] = {t: set() for t in procurement_types}
        for vendor_id, ptype, is_unrated in (
            db.query(VendorRating.vendor_id, VendorRating.procurement_type, VendorRating.is_unrated)
            .filter(VendorRating.vendor_id.in_(active_vendor_ids), VendorRating.procurement_type.in_(procurement_types))
            .all()
        ):
            if not is_unrated:
                rated_by_type[ptype].add(vendor_id)
        for t in procurement_types:
            unrated_by_type[t] = set(active_vendor_ids) - rated_by_type[t]

    results = []
    for li in tender.line_items:
        threshold = li.min_rating_threshold_override if li.min_rating_threshold_override is not None else tender.min_rating_threshold
        manual_invites = manual_invites_by_line.get(li.id, {})
        exclusions = exclusions_by_line.get(li.id, [])
        excluded_ids = {x.vendor_id for x in exclusions}
        eligible = [
            EligibleVendorOut(vendor_id=e.vendor.id, legal_name=e.vendor.legal_name, rating_score=e.rating_score, is_unrated=e.is_unrated, source=source)
            for e in resolve_eligible_vendors(li, db)
            if e.vendor.id not in manual_invites and e.vendor.id not in excluded_ids
        ]
        eligible += [
            EligibleVendorOut(
                vendor_id=g.vendor.id, legal_name=g.vendor.legal_name, rating_score=g.rating_at_resolution,
                is_unrated=g.is_unrated_at_resolution, source="manual", reason=g.reason,
            )
            for g in manual_invites.values()
        ]
        removed = [ExcludedVendorOut(vendor_id=x.vendor_id, legal_name=excluded_vendor_names[x.vendor_id], reason=x.reason) for x in exclusions]
        results.append(
            LineItemEligibilityOut(
                line_item_id=li.id,
                product_name=li.product.name,
                product_master_id=li.product_master_id,
                threshold_applied=threshold,
                eligible_vendors=eligible,
                removed_vendors=removed,
                unrated_vendor_ids=sorted(unrated_by_type.get(li.procurement_type, set())),
            )
        )
    return results


def _resolve_line(li: TenderLineItem, source: str, db: Session) -> tuple[bool, dict]:
    """Recomputes one line's invites. A manual invite (spec §6.6) survives
    while its vendor is Active, and a vendor the officer removed stays out.
    Returns whether the line ended with no invite at all, and the
    resolution record for audit."""

    manual_invites = db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == li.id, TenderInvite.source == "manual").all()
    for invite in manual_invites:
        if invite.vendor.status != VendorStatus.ACTIVE:
            db.delete(invite)
    db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == li.id, TenderInvite.source != "manual").delete(synchronize_session=False)
    invited = {g.vendor_id for g in manual_invites if g.vendor.status == VendorStatus.ACTIVE}
    removed = {x.vendor_id for x in db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == li.id).all()}
    eligible = [e for e in resolve_eligible_vendors(li, db) if e.vendor.id not in invited and e.vendor.id not in removed]
    for e in eligible:
        db.add(TenderInvite(tender_line_item_id=li.id, vendor_id=e.vendor.id, source=source, rating_at_resolution=e.rating_score, is_unrated_at_resolution=e.is_unrated))
    db.flush()
    entry = {
        "line_item_id": li.id,
        "product": li.product.name,
        "eligible": [{"vendor_id": e.vendor.id, "vendor": e.vendor.legal_name, "rating": e.rating_score} for e in eligible],
        "manual_invites": [{"vendor_id": g.vendor_id, "reason": g.reason} for g in manual_invites if g.vendor_id in invited],
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


@router.post("/{tender_id}/guest-invite-link/regenerate", response_model=TenderOut)
def regenerate_guest_invite_link(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """A new link; the old one stops working at once. No longer requires
    Open Tender to already be on (2026-10-28, user-directed, "unhook
    that") -- Guest Invite works as its own thing now. Still flips
    open_tender on behind the scenes if it wasn't already, since
    guest_invite_links.py's tender_for_token() still requires it for a
    visiting vendor to actually use the link, and that part was explicitly
    left alone ("I believe it gets marked as an open tender for other
    reasons so let that be") -- just no longer gated the other way around."""

    tender = _load_tender(tender_id, db)
    tender.open_tender = True
    tender.guest_invite_token = new_token()
    record(db, "tender.guest_invite_link_regenerated", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id)
    db.commit()
    db.refresh(tender)
    return tender


@router.delete("/{tender_id}/guest-invite-link", response_model=TenderOut)
def disable_guest_invite_link(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Turns the Guest Invite link off. Open Tender's own blast-invite of
    already-Active vendors is unaffected either way; only the link goes.
    Regenerating brings a link back."""

    tender = _load_tender(tender_id, db)
    tender.guest_invite_token = None
    record(db, "tender.guest_invite_link_disabled", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id)
    db.commit()
    db.refresh(tender)
    return tender


# ---- Invite List Manual Add (spec §6.6/§12.3) -- governed since 2026-10-22
# (user-directed, reversing the 2026-10-06 "no second approval step"
# decision). Same request/approve/reject convention as every other wired
# type: this endpoint only creates the OverrideRequest now -- the actual
# TenderInvite isn't created until approve_manual_invite runs. There's no
# existing row to anchor the override to before that invite exists, so
# entity_type/entity_id point at the line item, and tender_id/vendor_id/
# line_value live in proposed_change instead (read back by both the
# duplicate-pending check and the cumulative-value escalation trigger). ----


def _pending_manual_invite(db: Session, line_id: int, vendor_id: int) -> OverrideRequest | None:
    rows = (
        db.query(OverrideRequest)
        .filter(
            OverrideRequest.override_type == OverrideType.INVITE_LIST_MANUAL_ADD,
            OverrideRequest.entity_type == "tender_line_item",
            OverrideRequest.entity_id == line_id,
            OverrideRequest.status.in_([OverrideStatus.PENDING_APPROVAL, OverrideStatus.ESCALATED]),
        )
        .all()
    )
    return next((o for o in rows if (o.proposed_change or {}).get("vendor_id") == vendor_id), None)


def _get_manual_invite_request(db: Session, override_id: int) -> OverrideRequest:
    override = overrides.get_override(db, override_id)
    if override.override_type != OverrideType.INVITE_LIST_MANUAL_ADD:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a manual invite request")
    return override


def _cumulative_manual_invite_value(db: Session, tender_id: int) -> float:
    """Spec §12.3's "cumulative override value on the tender" -- every
    already-*approved* manual invite's own line value on this same tender,
    summed (same pattern as tenders.py's _cumulative_extension_days)."""

    rows = db.query(OverrideRequest.proposed_change).filter(
        OverrideRequest.override_type == OverrideType.INVITE_LIST_MANUAL_ADD, OverrideRequest.status == OverrideStatus.APPROVED
    )
    return sum((pc or {}).get("line_value", 0.0) for (pc,) in rows if (pc or {}).get("tender_id") == tender_id)


@router.post("/{tender_id}/lines/{line_item_id}/manual-invites", status_code=status.HTTP_201_CREATED)
def request_manual_invite(
    tender_id: int,
    line_item_id: int,
    payload: ManualInviteCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Spec §6.6 — officer requests inviting an Active vendor the eligibility
    rules didn't select, with a reason (built 2026-10-06 as a direct action;
    renamed from "guest invite" 2026-10-21 -- that name was a mislabel for a
    different, unimplemented spec §6.7 feature, see CLAUDE.md; governed
    2026-10-22, see module note above). Only while Draft, and never on an
    Open Tender (which already invites every Active vendor)."""

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
    if _pending_manual_invite(db, line.id, vendor.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A manual invite request for this vendor on this line is already pending")

    line_value = (line.estimated_price or 0.0) * (line.qty or 0.0)
    cumulative = _cumulative_manual_invite_value(db, tender.id) + line_value
    override = overrides.create_override(
        db, override_type=OverrideType.INVITE_LIST_MANUAL_ADD, initiator=user, entity_type="tender_line_item", entity_id=line.id,
        entity_label=f"#{tender.id} {tender.title} — {line.product.name} — {vendor.legal_name}", facility_id=tender.facility_id,
        justification=payload.justification,
        proposed_change={"tender_id": tender.id, "line_item_id": line.id, "vendor_id": vendor.id, "vendor_name": vendor.legal_name, "line_value": line_value},
        trigger_value=cumulative,
    )
    if override.status == OverrideStatus.APPROVED:  # self-attested (2026-10-30) -- apply right now
        _apply_manual_invite(db, override, user)
    db.commit()
    db.refresh(override)
    return {"override_id": override.id, "status": override.status, "required_approver_role": override.required_approver_role}


def _apply_manual_invite(db: Session, override: OverrideRequest, actor: UserAccount) -> TenderInvite:
    """Shared by the approve endpoint and a self-attested request's own
    inline apply (2026-10-30, same split as _apply_due_date_extension above):
    an Approved override alone never touches the target record (spec
    §12.1/§12.2) -- this is the one place that actually creates the
    TenderInvite, whichever path got the override to Approved."""

    pc = override.proposed_change
    line = db.get(TenderLineItem, pc["line_item_id"])
    vendor = db.get(Vendor, pc["vendor_id"])
    if line is None or vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The line or vendor no longer exists")
    if db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id, TenderInvite.vendor_id == vendor.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This vendor is already invited to this line")
    manual_score, manual_is_unrated = rating_score_detail(vendor.id, line.procurement_type, db)
    invite = TenderInvite(
        tender_line_item_id=line.id,
        vendor_id=vendor.id,
        source="manual",
        reason=override.justification,
        rating_at_resolution=manual_score,
        is_unrated_at_resolution=manual_is_unrated,
    )
    db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == line.id, TenderLineExclusion.vendor_id == vendor.id).delete(
        synchronize_session=False
    )
    db.add(invite)
    tender = line.tender
    record(
        db, "tender.manual_invite_added", "tender", tender.id, actor=actor, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        after={"line_item_id": line.id, "vendor_id": vendor.id, "vendor": vendor.legal_name}, reason=override.justification,
        meta={"override_id": override.id},
    )
    db.flush()
    return invite


@router.post("/manual-invite-requests/{override_id}/approve", response_model=TenderInviteOut)
def approve_manual_invite(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_manual_invite_request(db, override_id)
    overrides.approve_override(db, override, user, payload.reason)
    invite = _apply_manual_invite(db, override, user)
    db.commit()
    db.refresh(invite)
    return invite


@router.post("/manual-invite-requests/{override_id}/reject")
def reject_manual_invite(override_id: int, payload: OverrideRejection, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_manual_invite_request(db, override_id)
    overrides.reject_override(db, override, user, payload.reason or "")
    db.commit()
    return {"override_id": override.id, "status": override.status}


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
    # Batched (2026-10-13, performance): one delete + one select for the
    # whole selection, instead of one of each per vendor.
    vendor_ids = [v.id for v in vendors]
    db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id, TenderInvite.vendor_id.in_(vendor_ids)).delete(synchronize_session=False)
    existing_by_vendor = {
        x.vendor_id: x
        for x in db.query(TenderLineExclusion).filter(TenderLineExclusion.tender_line_item_id == line.id, TenderLineExclusion.vendor_id.in_(vendor_ids)).all()
    }
    for vendor in vendors:
        existing = existing_by_vendor.get(vendor.id)
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
    now = datetime.now(timezone.utc)
    if tender.bid_due_date <= now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bid Due Date must be in the future")
    if tender.publish_date is not None:
        if tender.publish_date <= now:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Publish Date must be in the future")
        if tender.bid_due_date <= tender.publish_date:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bid Due Date must be after the Publish Date")
    # Contract start/end dates are NOT required here anymore (2026-10-28,
    # user-directed): a rate contract's dates only become meaningful once
    # there's an actual award to date against, which is still evaluation
    # rounds away at this point. They're set at L1-submission time instead
    # (awards.py's submit_for_l1_approval) -- see this file's own comment
    # in Tender's is_rate_contract block for the full reasoning.
    if tender.is_rate_contract and not tender.rate_contract_document_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The Rate Contract agreement document must be uploaded before submission")
    if not tender.terms_document_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A Terms & Conditions document must be uploaded before submission")

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
        # Real bug, found 2026-10-28 (user-reported): each weight was only
        # ever checked individually (>0) -- nothing anywhere, frontend or
        # backend, actually required them to add up to 100, so a QCBS line
        # could be submitted (and scored) with e.g. technical=70/price=70.
        if li.technical_eval_method == TechnicalEvalMethod.QCBS and abs((li.technical_weight or 0) + (li.price_weight or 0) - 100) > 0.01:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line item '{li.product.name}' (QCBS): technical weight + price weight must add up to 100",
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

    now = datetime.now(timezone.utc)
    # Real bug, found 2026-10-16: Publish Date (set at tender creation,
    # shown on this review screen) used to be pure decoration -- approval
    # always flipped straight to Published regardless of it. A publish date
    # in the future now holds the tender in Scheduled instead; invites and
    # per-line published flags are still resolved/persisted right here (same
    # as always), services/tender_publish.py's sweep just flips the status
    # once that date arrives -- nothing about eligibility is re-resolved then.
    scheduled = tender.publish_date is not None and tender.publish_date > now

    round_.decision = RoundDecision.APPROVED
    round_.comments = payload.comments if payload else None
    round_.reviewer_id = user.id
    round_.decided_at = now
    tender.status = TenderStatus.SCHEDULED if scheduled else TenderStatus.PUBLISHED
    tender.published_at = None if scheduled else now
    tender.consecutive_rejections = 0
    label = _audit_label(tender)
    record(
        db, "tender.eligibility_resolved", "tender", tender.id, actor=user, entity_label=label, facility_id=tender.facility_id,
        after={"lines": resolution}, meta={"at": "approval", "round_number": round_.round_number},
    )
    record(
        db, "tender.approved", "tender", tender.id, actor=user, entity_label=label, facility_id=tender.facility_id,
        before={"status": TenderStatus.PENDING_APPROVAL}, after={"status": tender.status}, reason=payload.comments if payload else None,
        meta={
            "round_number": round_.round_number, "required_tier": round_.required_tier,
            "lines_published": len(invited_line_ids), "lines_held": len(tender.line_items) - len(invited_line_ids),
            "scheduled_for": tender.publish_date.isoformat() if scheduled else None,
        },
    )
    if not scheduled:
        db.flush()  # push li.published above -- notify_invited_vendors queries it back (session has autoflush=False)
        notify_invited_vendors(db, tender)
    approve_body = (
        f"Approved and scheduled to publish on {tender.publish_date.strftime('%d %b %Y')}." if scheduled
        else "Approved and published -- vendors have been notified."
    )
    _notify_round_submitter(db, tender, round_, "tender_approved", f"Tender approved: {tender.title}", approve_body)
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
    _notify_round_submitter(db, tender, round_, "tender_rejected", f"Tender rejected: {tender.title}", payload.comments)
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/withdraw-to-draft", response_model=TenderOut)
def withdraw_to_draft(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Lets a Published (or Scheduled -- approved, but still waiting on its
    publish date) tender be pulled back to Draft for editing -- line items
    can only be added/changed while Draft (see add_line_item/_require_draft
    above). Refused once any vendor has already bid on it: reopening line
    items after real bids exist would silently invalidate what those
    vendors bid against, with nothing here to notify them. A Scheduled
    tender can never have a bid yet (bids.py's lock_reason only opens
    bidding once status is actually Published), so this check is a no-op
    for it, not a separate code path. A tender with no bids yet has nothing
    to protect, so it's a plain revert, not a governed override -- there's
    no separate approval step for undoing your own not-yet-acted-on publish."""

    tender = _load_tender(tender_id, db)
    if tender.status not in (TenderStatus.PUBLISHED, TenderStatus.SCHEDULED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is in status '{tender.status.value}', not Published")

    line_item_ids = [li.id for li in tender.line_items]
    bid_count = db.query(Bid).filter(Bid.tender_line_item_id.in_(line_item_ids), Bid.status == BidStatus.SUBMITTED).count() if line_item_ids else 0
    if bid_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot revert to Draft: {bid_count} bid(s) have already been submitted against this tender",
        )

    previous_status = tender.status
    tender.status = TenderStatus.DRAFT
    tender.published_at = None
    for li in tender.line_items:
        li.published = False
    record(
        db, "tender.withdrawn_to_draft", "tender", tender.id, actor=user, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        before={"status": previous_status}, after={"status": TenderStatus.DRAFT},
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
        db.add(TenderInvite(tender_line_item_id=line.id, vendor_id=e.vendor.id, rating_at_resolution=e.rating_score, is_unrated_at_resolution=e.is_unrated))
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
    return db.query(TenderInvite).filter(TenderInvite.tender_line_item_id.in_(line_item_ids)).order_by(TenderInvite.created_at.desc(), TenderInvite.id.desc()).all()


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


# ---- Late-Submission Exception (spec §8.4) -- the override engine's two
# already-wired examples (ratings.py's price-competitiveness override,
# evaluation.py's technical-score correction) are both mirrored exactly
# here: a dedicated request endpoint calls overrides.create_override(),
# dedicated approve/reject endpoints call overrides.approve_override()/
# reject_override() and then, only on approve, apply the real mutation
# inline. OverrideRequest.initiator_id is a non-nullable staff UserAccount
# FK, so the vendor's late bid alone can't file this -- a Procurement
# Officer/Admin has to see it (status PENDING_LATE_EXCEPTION) and request
# the exception on its behalf. ----


def _pending_late_exception(db: Session, bid_id: int) -> OverrideRequest | None:
    return (
        db.query(OverrideRequest)
        .filter(
            OverrideRequest.override_type == OverrideType.LATE_SUBMISSION_EXCEPTION,
            OverrideRequest.entity_type == "bid",
            OverrideRequest.entity_id == bid_id,
            OverrideRequest.status.in_([OverrideStatus.PENDING_APPROVAL, OverrideStatus.ESCALATED]),
        )
        .order_by(OverrideRequest.created_at.desc())
        .first()
    )


def _get_late_exception(db: Session, override_id: int) -> OverrideRequest:
    override = overrides.get_override(db, override_id)
    if override.override_type != OverrideType.LATE_SUBMISSION_EXCEPTION:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a late-submission exception")
    return override


@router.post("/{tender_id}/lines/{line_item_id}/bids/{bid_id}/late-submission-exception", status_code=status.HTTP_201_CREATED)
def request_late_submission_exception(
    tender_id: int,
    line_item_id: int,
    bid_id: int,
    payload: LateSubmissionExceptionRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS, Role.CATEGORY_MANAGER)),
):
    """A bid the vendor submitted after the deadline is held as
    PENDING_LATE_EXCEPTION, not rejected (app/services/bids.py's
    assert_can_bid) -- this is the staff step that actually asks for it to
    be admitted. trigger_value is the bid's own landed line value, feeding
    the seeded escalation threshold (tender value) to Approving Authority."""

    tender = _load_tender(tender_id, db)
    line = _line_of(tender, line_item_id)
    bid = db.get(Bid, bid_id)
    if bid is None or bid.tender_line_item_id != line.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bid not found on this line")
    if bid.status != BidStatus.PENDING_LATE_EXCEPTION:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This bid isn't a pending late submission")
    if _pending_late_exception(db, bid.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A late-submission exception is already pending for this bid")
    landed_value = (bid.unit_price or 0) * (line.qty or 0)
    override = overrides.create_override(
        db, override_type=OverrideType.LATE_SUBMISSION_EXCEPTION, initiator=user, entity_type="bid", entity_id=bid.id,
        entity_label=f"#{tender.id} {tender.title} — {line.product.name} — {bid.vendor.legal_name}", facility_id=tender.facility_id,
        justification=payload.justification, trigger_value=landed_value,
        proposed_change={"before": BidStatus.PENDING_LATE_EXCEPTION, "after": BidStatus.SUBMITTED},
    )
    db.commit()
    db.refresh(override)
    return {"override_id": override.id, "status": override.status, "required_approver_role": override.required_approver_role}


@router.post("/late-submission-exceptions/{override_id}/approve")
def approve_late_submission_exception(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_late_exception(db, override_id)
    overrides.approve_override(db, override, user, payload.reason)

    bid = db.get(Bid, override.entity_id)
    bid.status = BidStatus.SUBMITTED
    line = bid.line_item
    tender = line.tender
    record(
        db, "bid.late_submission_accepted", "bid", bid.id, actor=user, entity_label=f"#{tender.id} {tender.title} — {line.product.name}",
        facility_id=tender.facility_id, reason=override.justification, meta={"tender_id": tender.id, "line_item_id": line.id, "override_id": override.id},
    )
    notify_vendor(
        db, bid.vendor_id, "late_submission_accepted", f"Late bid accepted: {tender.title}",
        f"Your bid for {line.product.name} on tender #{tender.id} ({tender.title}), submitted after the deadline, has been accepted into evaluation.",
        tender.id,
    )
    db.commit()
    return {"override_id": override.id, "status": override.status, "bid_status": bid.status}


@router.post("/late-submission-exceptions/{override_id}/reject")
def reject_late_submission_exception(override_id: int, payload: OverrideRejection, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_late_exception(db, override_id)
    overrides.reject_override(db, override, user, payload.reason or "")

    bid = db.get(Bid, override.entity_id)  # stays PENDING_LATE_EXCEPTION -- permanently excluded, nothing to mutate
    line = bid.line_item
    tender = line.tender
    notify_vendor(
        db, bid.vendor_id, "late_submission_rejected", f"Late bid not accepted: {tender.title}",
        f"Your bid for {line.product.name} on tender #{tender.id} ({tender.title}), submitted after the deadline, was not accepted. Reason: {override.decision_reason or 'not stated'}.",
        tender.id,
    )
    db.commit()
    return {"override_id": override.id, "status": override.status}


# ---- Bid Due-Date Extension (spec §9.6) -- the one override type in this
# engine where self_attested=True actually gets exercised for real: a
# Procurement Officer requesting it under the cumulative-days threshold
# gets back an already-APPROVED override from create_override() itself, so
# the request endpoint applies the mutation inline in that case; the
# escalated (over-threshold) case applies it from a separate approve
# endpoint instead. _apply_due_date_extension() is shared by both so the
# mutation/audit/notify logic isn't duplicated. ----


def _cumulative_extension_days(db: Session, tender_id: int) -> float:
    rows = (
        db.query(OverrideRequest.proposed_change)
        .filter(
            OverrideRequest.override_type == OverrideType.DUE_DATE_EXTENSION,
            OverrideRequest.entity_type == "tender",
            OverrideRequest.entity_id == tender_id,
            OverrideRequest.status == OverrideStatus.APPROVED,
        )
        .all()
    )
    return sum((pc or {}).get("extension_days", 0) for (pc,) in rows)


def _apply_due_date_extension(db: Session, tender: Tender, override: OverrideRequest, actor: UserAccount) -> None:
    before = {"bid_due_date": tender.bid_due_date}
    new_due_date = datetime.fromisoformat(override.proposed_change["after"])
    tender.bid_due_date = new_due_date
    record(
        db, "tender.bid_due_date_extended", "tender", tender.id, actor=actor, entity_label=_audit_label(tender), facility_id=tender.facility_id,
        before=before, after={"bid_due_date": tender.bid_due_date}, reason=override.justification,
        meta={"override_id": override.id, "extension_days": override.proposed_change.get("extension_days")},
    )
    notify_due_date_extended(db, tender)


def _get_due_date_extension(db: Session, override_id: int) -> OverrideRequest:
    override = overrides.get_override(db, override_id)
    if override.override_type != OverrideType.DUE_DATE_EXTENSION:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a bid due-date extension")
    return override


@router.post("/{tender_id}/bid-due-date-extension", status_code=status.HTTP_201_CREATED)
def request_due_date_extension(
    tender_id: int,
    payload: DueDateExtensionRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS, Role.CATEGORY_MANAGER)),
):
    """Procurement Officer self-attested up to the configured cumulative-days
    threshold (OverrideTypeConfig, seeded 7.0 days); beyond it, escalates to
    Category Manager. Can't extend an already-passed deadline (that's the
    late-submission exception's territory) or once any line's technical
    evaluation has closed (spec §9.6: "once prices unlock, the due date is
    locked")."""

    tender = _load_tender(tender_id, db)
    if tender.status not in (TenderStatus.PUBLISHED, TenderStatus.SCHEDULED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is '{tender.status.value}', not published")
    if tender.bid_due_date is None or payload.new_due_date <= tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The new due date must be later than the current one")
    now = datetime.now(timezone.utc)
    if tender.bid_due_date <= now:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The bid deadline has already passed -- this needs a late-submission exception instead")
    if any(li.technical_closed_at is not None for li in tender.line_items):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prices have already started unlocking for this tender -- the due date is locked")

    extension_days = (payload.new_due_date - tender.bid_due_date).total_seconds() / 86400
    cumulative_days = _cumulative_extension_days(db, tender.id) + extension_days
    override = overrides.create_override(
        db, override_type=OverrideType.DUE_DATE_EXTENSION, initiator=user, entity_type="tender", entity_id=tender.id,
        entity_label=_audit_label(tender), facility_id=tender.facility_id, justification=payload.justification,
        trigger_value=cumulative_days,
        proposed_change={"before": tender.bid_due_date.isoformat(), "after": payload.new_due_date.isoformat(), "extension_days": extension_days},
    )
    if override.status == OverrideStatus.APPROVED:  # self-attested, under threshold -- apply right now
        _apply_due_date_extension(db, tender, override, user)
    db.commit()
    db.refresh(override)
    return {"override_id": override.id, "status": override.status, "required_approver_role": override.required_approver_role}


@router.post("/bid-due-date-extensions/{override_id}/approve", response_model=TenderOut)
def approve_due_date_extension(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_due_date_extension(db, override_id)
    overrides.approve_override(db, override, user, payload.reason)

    tender = db.get(Tender, override.entity_id)
    _apply_due_date_extension(db, tender, override, user)
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/bid-due-date-extensions/{override_id}/reject")
def reject_due_date_extension(override_id: int, payload: OverrideRejection, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_due_date_extension(db, override_id)
    overrides.reject_override(db, override, user, payload.reason or "")
    db.commit()
    return {"override_id": override.id, "status": override.status}
