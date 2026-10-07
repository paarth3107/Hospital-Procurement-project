from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid, BidAttachment, BidAttachmentKind, BidStatus
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.vendor import Vendor, VendorStatus
from app.schemas.bid import AttachmentOut, BidBulkSave, BidBulkSaveResult, BidFormOut, BidSave, CatalogSpecOut, LineContextOut, MyBidOut, TenderBidsOut
from app.schemas.tender import LineAttachmentOut
from app.security import get_current_vendor
from app.services import bids as rules
from app.services import document_store
from app.services.expiry import sweep_vendor
from app.models.award import APPROVED, FINAL, AwardRound
from app.models.bid_evaluation import BidTechnicalResult, TechnicalDecision
from app.models.tender import TenderStatus
from app.services.audit import record

router = APIRouter(prefix="/api/v1/vendor-portal/bids", tags=["vendor-bids"])

BID_FIELDS = ("unit_price", "gst_percent", "other_duties", "delivery_lead_days", "quote_validity_days", "payment_terms", "compliant_full", "technical_compliance", "brand_offered", "comments")
MAX_ATTACHMENTS_PER_BID = 20


def _line(db: Session, line_item_id: int) -> TenderLineItem:
    line = db.get(TenderLineItem, line_item_id)
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender line item not found")
    return line


def _own_bid(db: Session, vendor: Vendor, line: TenderLineItem) -> Bid | None:
    return db.query(Bid).filter(Bid.tender_line_item_id == line.id, Bid.vendor_id == vendor.id).first()


def _load_bid(db: Session, vendor: Vendor, bid_id: int) -> Bid:
    bid = db.get(Bid, bid_id)
    if not bid or bid.vendor_id != vendor.id:  # never reveal another vendor's bid exists
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bid not found")
    return bid


def _audit(db: Session, action: str, vendor: Vendor, bid: Bid, line: TenderLineItem, fields: list[str] | None = None, reason: str | None = None):
    # Sealed-bid rule (spec 9.6): field NAMES only, never the price or any other value.
    tender = line.tender
    record(
        db, action, "bid", bid.id, actor=vendor, entity_label=f"#{tender.id} {tender.title} - {line.product.name}",
        facility_id=tender.facility_id, reason=reason,
        meta={"tender_id": tender.id, "line_item_id": line.id, **({"fields_changed": fields} if fields else {})},
    )


def _form(db: Session, vendor: Vendor, line: TenderLineItem, bid: Bid | None) -> BidFormOut:
    tender = line.tender
    product = line.product
    return BidFormOut(
        context=LineContextOut(
            line_item_id=line.id,
            tender_id=tender.id,
            tender_title=tender.title,
            tender_type=tender.tender_type,
            product_name=product.name,
            procurement_type=line.procurement_type,
            qty=line.qty,
            uom=product.unit_of_measure,
            bid_due_date=tender.bid_due_date,
            technical_eval_method=line.technical_eval_method,
            technical_weight=line.technical_weight,
            price_weight=line.price_weight,
            split_award_allowed=line.split_award_allowed,
            shelf_life_tracked=rules.shelf_life_tracked(line),
            catalog_spec=CatalogSpecOut(
                unit_of_measure=product.unit_of_measure,
                regulatory_class=product.regulatory_class,
                approved_brands=product.approved_brands or [],
                type_specific_attrs=product.type_specific_attrs or {},
            ),
            line_details=line.line_details or {},
            attachments=[LineAttachmentOut.model_validate(a) for a in line.attachments],
        ),
        requirements=rules.requirements(line, bid),
        bid=rules.bid_out(bid) if bid else None,
        locked=rules.lock_reason(vendor, line) is not None,
        lock_reason=rules.lock_reason(vendor, line),
    )


def _outcome(db: Session, b: Bid) -> str | None:
    """What the vendor may know about their own bid's result (spec 11.1: vendors view the outcome)."""
    res = db.query(BidTechnicalResult).filter(BidTechnicalResult.bid_id == b.id).first()
    if res is not None and res.outcome == TechnicalDecision.DISQUALIFIED:
        return "Technically disqualified"
    line = b.line_item
    if line.tender.status not in (TenderStatus.AWARDED, TenderStatus.NO_AWARD):
        return None
    rnd = db.query(AwardRound).filter(AwardRound.line_item_id == line.id, AwardRound.status == APPROVED).order_by(AwardRound.round_number.desc()).first()
    if rnd is not None:
        for a in rnd.allocations:
            if a.stage == FINAL and a.bid_id == b.id:
                qty = line.qty * a.share_pct / 100.0
                return f"Awarded ({qty:g})"
    return "Not selected"


@router.get("", response_model=list[MyBidOut])
def list_my_bids(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    out = []
    for b in db.query(Bid).filter(Bid.vendor_id == vendor.id).order_by(Bid.updated_at.desc()).all():
        line = b.line_item
        out.append(
            MyBidOut(
                id=b.id, tender_line_item_id=line.id, tender_id=line.tender.id, tender_title=line.tender.title,
                product_name=line.product.name, qty=line.qty, status=b.status, unit_price=b.unit_price,
                total_price=b.unit_price * line.qty if b.unit_price is not None else None, submitted_at=b.submitted_at, outcome=_outcome(db, b),
            )
        )
    return out


@router.get("/line/{line_item_id}", response_model=BidFormOut)
def get_bid_form(line_item_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    line = _line(db, line_item_id)
    invited = db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id, TenderInvite.vendor_id == vendor.id).first()
    if not invited:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You were not invited to bid on this line item")
    return _form(db, vendor, line, _own_bid(db, vendor, line))


@router.get("/line/{line_item_id}/spec-attachments/{attachment_id}/download")
def download_spec_attachment(line_item_id: int, attachment_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """The officer's own line-item documents (SOW, technical spec sheet,
    engineering drawing, reference image -- spec §6.4), read-only, for a
    vendor invited to this line. Deliberately separate from tenders.py's
    staff-only download_line_attachment (get_current_user rejects a vendor
    token, by design) -- this is its own vendor-scoped route, gated on the
    invite rather than staff role."""

    line = _line(db, line_item_id)
    invited = db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id, TenderInvite.vendor_id == vendor.id).first()
    if not invited:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You were not invited to bid on this line item")
    att = next((a for a in line.attachments if a.id == attachment_id), None)
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return Response(content=att.content, media_type=att.content_type, headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'})


def _apply_bid_save(db: Session, vendor: Vendor, line: TenderLineItem, payload: BidSave) -> Bid:
    """Create/reopen/update one line's bid and run the submit gate if needed --
    shared by the single-line PUT and the bulk grid-save PUT (2026-10-01) so
    the rule (spec 8.4: a submitted bid must stay complete) isn't duplicated.
    Raises HTTPException on any problem; the caller decides how much to roll
    back (the whole request for a single line, just this line's savepoint
    for a bulk save)."""

    rules.assert_can_bid(db, vendor, line)

    bid = _own_bid(db, vendor, line)
    created = bid is None
    reopened = bool(bid and bid.status == BidStatus.WITHDRAWN)
    if created:
        bid = Bid(tender_line_item_id=line.id, vendor_id=vendor.id, status=BidStatus.DRAFT, details={})
        db.add(bid)
        db.flush()
    elif reopened:
        bid.status = BidStatus.DRAFT
        bid.withdrawn_at = None

    new_details = rules.clean_details(line, payload.details)
    changed = [f for f in BID_FIELDS if getattr(bid, f) != getattr(payload, f)]
    changed += [f"details.{k}" for k in sorted(set(bid.details or {}) | set(new_details)) if (bid.details or {}).get(k) != new_details.get(k)]
    for f in BID_FIELDS:
        setattr(bid, f, getattr(payload, f))
    if bid.compliant_full:  # fully compliant: no deviations text to keep
        bid.technical_compliance = None
    bid.details = new_details

    was_submitted = bid.status == BidStatus.SUBMITTED
    if was_submitted or payload.submit:
        db.flush()
        db.refresh(bid)
        problems = rules.submit_problems(bid, line)
        if problems:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Can't " + ("save this amendment" if was_submitted else "submit yet") + " — missing: " + "; ".join(problems),
            )
    now = datetime.now(timezone.utc)
    if payload.submit and not was_submitted:
        bid.status = BidStatus.SUBMITTED
        if bid.submitted_at is None:
            bid.submitted_at = now
        _audit(db, "bid.submitted", vendor, bid, line, changed)
    elif was_submitted:
        bid.amended_at = now
        _audit(db, "bid.amended", vendor, bid, line, changed)
    else:
        if reopened:
            _audit(db, "bid.reopened", vendor, bid, line)
        _audit(db, "bid.draft_created" if created else "bid.draft_saved", vendor, bid, line, changed)
    return bid


@router.put("/line/{line_item_id}", response_model=BidFormOut)
def save_bid(line_item_id: int, payload: BidSave, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Save a draft, submit, or amend a submitted bid (until the deadline).
    A submitted bid must stay complete: an amendment that would leave a
    required field or mandatory attachment missing is refused."""

    line = _line(db, line_item_id)
    try:
        bid = _apply_bid_save(db, vendor, line, payload)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(bid)
    return _form(db, vendor, line, bid)


@router.get("/tender/{tender_id}", response_model=TenderBidsOut)
def list_tender_bid_forms(tender_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Every line this vendor was invited to bid on within one tender, in a
    single call -- backs the bid grid (2026-10-01), replacing the previous
    /vendor-portal/tenders + one GET per line pattern."""

    lines = (
        db.query(TenderLineItem)
        .join(TenderInvite, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .filter(TenderInvite.vendor_id == vendor.id, TenderLineItem.tender_id == tender_id)
        .order_by(TenderLineItem.id)
        .all()
    )
    if not lines:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No lines you're invited to bid on in this tender")
    tender = lines[0].tender
    forms = [_form(db, vendor, line, _own_bid(db, vendor, line)) for line in lines]
    return TenderBidsOut(
        tender_id=tender.id, tender_title=tender.title, tender_type=tender.tender_type,
        tender_description=tender.description, facility_name=tender.facility.name,
        terms_document_filename=tender.terms_document_filename,
        open_tender=tender.open_tender,
        is_rate_contract=tender.is_rate_contract, contract_start_date=tender.contract_start_date, contract_end_date=tender.contract_end_date,
        rate_contract_document_filename=tender.rate_contract_document_filename,
        bid_due_date=tender.bid_due_date, lines=forms,
    )


@router.get("/tender/{tender_id}/terms-document/download")
def download_tender_terms_document(tender_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """The tender's Terms & Conditions document (2026-10-07), read-only, for a
    vendor invited to at least one line of it -- same gating as a line's own
    spec-attachments download below."""

    invited = (
        db.query(TenderLineItem)
        .join(TenderInvite, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .filter(TenderInvite.vendor_id == vendor.id, TenderLineItem.tender_id == tender_id)
        .first()
    )
    if not invited:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No lines you're invited to bid on in this tender")
    tender = invited.tender
    if not tender.terms_document_content:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Terms & Conditions document uploaded")
    return Response(
        content=tender.terms_document_content, media_type=tender.terms_document_content_type,
        headers={"Content-Disposition": f'inline; filename="{tender.terms_document_filename}"'},
    )


@router.get("/tender/{tender_id}/rate-contract-document/download")
def download_tender_rate_contract_document(tender_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """The signed Rate Contract agreement (2026-10-07), read-only, for a vendor
    invited to at least one line of it -- same gating as the terms document above."""

    invited = (
        db.query(TenderLineItem)
        .join(TenderInvite, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .filter(TenderInvite.vendor_id == vendor.id, TenderLineItem.tender_id == tender_id)
        .first()
    )
    if not invited:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No lines you're invited to bid on in this tender")
    tender = invited.tender
    if not tender.rate_contract_document_content:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Rate Contract agreement uploaded")
    return Response(
        content=tender.rate_contract_document_content, media_type=tender.rate_contract_document_content_type,
        headers={"Content-Disposition": f'inline; filename="{tender.rate_contract_document_filename}"'},
    )


@router.put("/tender/{tender_id}", response_model=list[BidBulkSaveResult])
def bulk_save_bids(tender_id: int, payload: BidBulkSave, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Saves many lines' bids in one request -- the grid's "Save all drafts"
    button and CSV import (2026-10-01), mirroring the tender line-item bulk
    save. Each line is its own SAVEPOINT: one line failing (e.g. a submit
    attempt missing a mandatory field) doesn't lose another line's save in
    the same batch, matching the CSV importer's own partial-success pattern.
    Pre-sweeps the vendor's expiry status once up front rather than letting
    assert_can_bid's own sweep fire (and possibly commit) from inside a
    per-line savepoint."""

    if sweep_vendor(db, vendor):
        db.commit()

    results: list[BidBulkSaveResult] = []
    for line_save in payload.lines:
        line = db.get(TenderLineItem, line_save.line_item_id)
        if not line or line.tender_id != tender_id:
            results.append(BidBulkSaveResult(line_item_id=line_save.line_item_id, ok=False, error="Line item not found in this tender"))
            continue
        try:
            with db.begin_nested():
                bid = _apply_bid_save(db, vendor, line, line_save)
                db.flush()
        except HTTPException as e:
            results.append(BidBulkSaveResult(line_item_id=line.id, ok=False, error=str(e.detail)))
            continue
        db.refresh(bid)
        results.append(BidBulkSaveResult(line_item_id=line.id, ok=True, form=_form(db, vendor, line, bid)))
    db.commit()
    return results


@router.post("/tender/{tender_id}/reopen", response_model=list[BidFormOut])
def reopen_tender_bids(tender_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Undoes the tender-wide Submit Bid action (2026-10-01, user-directed:
    bidding is one tender-level action from the vendor's side, not
    independent per-line submit/withdraw/amend). Every SUBMITTED line's bid
    in this tender reverts to Draft; submitted_at is cleared so a genuine
    resubmission gets a fresh tie-break timestamp rather than keeping the
    original one for what may now be materially different content."""

    lines = (
        db.query(TenderLineItem)
        .join(TenderInvite, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .filter(TenderInvite.vendor_id == vendor.id, TenderLineItem.tender_id == tender_id)
        .all()
    )
    if not lines:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No lines you're invited to bid on in this tender")
    tender = lines[0].tender
    if vendor.status != VendorStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an Active, approved vendor may bid")
    if tender.bid_due_date is None or datetime.now(timezone.utc) > tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The bid deadline for this tender has passed")

    reopened_any = False
    for line in lines:
        bid = _own_bid(db, vendor, line)
        if bid and bid.status == BidStatus.SUBMITTED:
            bid.status = BidStatus.DRAFT
            bid.submitted_at = None
            bid.amended_at = None
            reopened_any = True
            _audit(db, "bid.reopened_for_editing", vendor, bid, line)
    if not reopened_any:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nothing submitted to reopen")
    db.commit()
    return [_form(db, vendor, line, _own_bid(db, vendor, line)) for line in lines]


@router.post("/{bid_id}/withdraw", response_model=BidFormOut)
def withdraw_bid(bid_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    bid = _load_bid(db, vendor, bid_id)
    line = bid.line_item
    rules.assert_can_bid(db, vendor, line)
    if bid.status != BidStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a submitted bid can be withdrawn")
    bid.status = BidStatus.WITHDRAWN
    bid.withdrawn_at = datetime.now(timezone.utc)
    _audit(db, "bid.withdrawn", vendor, bid, line)
    db.commit()
    db.refresh(bid)
    return _form(db, vendor, line, bid)


@router.post("/{bid_id}/attachments", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def add_attachment(
    bid_id: int,
    kind: BidAttachmentKind = Form(...),
    description: str | None = Form(None),
    file: UploadFile = File(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: Session = Depends(get_db),
):
    bid = _load_bid(db, vendor, bid_id)
    line = bid.line_item
    rules.assert_can_bid(db, vendor, line)
    if bid.status == BidStatus.WITHDRAWN:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This bid is withdrawn; reopen it by saving it again first")
    if kind not in {s.kind for s in rules.requirements(line, bid).slots}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That attachment type isn't used for this line")
    if len(bid.attachments) >= MAX_ATTACHMENTS_PER_BID:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"At most {MAX_ATTACHMENTS_PER_BID} attachments per bid")
    content = await file.read()
    try:
        document_store.validate(file.content_type or "", len(content), allow_office=True)
    except document_store.DocumentValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    document_store.scan(content)
    att = BidAttachment(
        bid_id=bid.id, kind=kind, description=(description or "").strip() or None, original_filename=file.filename,
        content_type=file.content_type, size_bytes=len(content), content=content,
    )
    db.add(att)
    if bid.status == BidStatus.SUBMITTED:
        bid.amended_at = datetime.now(timezone.utc)
    db.flush()
    _audit(db, "bid.attachment_added", vendor, bid, line, [kind.value])
    db.commit()
    db.refresh(att)
    return att


@router.delete("/{bid_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(bid_id: int, attachment_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    bid = _load_bid(db, vendor, bid_id)
    line = bid.line_item
    rules.assert_can_bid(db, vendor, line)
    att = next((a for a in bid.attachments if a.id == attachment_id), None)
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    kind = att.kind
    bid.attachments.remove(att)
    db.flush()
    db.refresh(bid)
    if bid.status == BidStatus.SUBMITTED:
        problems = rules.submit_problems(bid, line)
        if problems:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A submitted bid must keep its mandatory attachment — upload a replacement first")
        bid.amended_at = datetime.now(timezone.utc)
    _audit(db, "bid.attachment_removed", vendor, bid, line, [kind.value])
    db.commit()


@router.get("/{bid_id}/attachments/{attachment_id}/download")
def download_attachment(bid_id: int, attachment_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    bid = _load_bid(db, vendor, bid_id)
    att = next((a for a in bid.attachments if a.id == attachment_id), None)
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return Response(
        content=att.content,
        media_type=att.content_type,
        headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'},
    )
