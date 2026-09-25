from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid, BidAttachment, BidAttachmentKind, BidStatus
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.vendor import Vendor
from app.schemas.bid import AttachmentOut, BidFormOut, BidSave, LineContextOut, MyBidOut
from app.security import get_current_vendor
from app.services import bids as rules
from app.services import document_store
from app.models.award import APPROVED, FINAL, AwardRound
from app.models.bid_evaluation import BidTechnicalResult, TechnicalDecision
from app.models.tender import TenderStatus
from app.services.audit import record

router = APIRouter(prefix="/api/v1/vendor-portal/bids", tags=["vendor-bids"])

BID_FIELDS = ("unit_price", "gst_percent", "other_duties", "delivery_lead_days", "quote_validity_days", "payment_terms", "technical_compliance", "brand_offered")
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
    return BidFormOut(
        context=LineContextOut(
            line_item_id=line.id,
            tender_id=tender.id,
            tender_title=tender.title,
            tender_type=tender.tender_type,
            product_name=line.product.name,
            procurement_type=line.procurement_type,
            qty=line.qty,
            uom=line.product.unit_of_measure,
            bid_due_date=tender.bid_due_date,
            technical_eval_method=line.technical_eval_method,
            shelf_life_tracked=rules.shelf_life_tracked(line),
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


@router.put("/line/{line_item_id}", response_model=BidFormOut)
def save_bid(line_item_id: int, payload: BidSave, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Save a draft, submit, or amend a submitted bid (until the deadline).
    A submitted bid must stay complete: an amendment that would leave a
    required field or mandatory attachment missing is refused."""

    line = _line(db, line_item_id)
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
    bid.details = new_details

    was_submitted = bid.status == BidStatus.SUBMITTED
    if was_submitted or payload.submit:
        db.flush()
        db.refresh(bid)
        problems = rules.submit_problems(bid, line)
        if problems:
            db.rollback()
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
    db.commit()
    db.refresh(bid)
    return _form(db, vendor, line, bid)


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
