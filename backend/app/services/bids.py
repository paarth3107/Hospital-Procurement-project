"""Bid rules (spec §8): who may bid, what a bid must contain to be submitted,
and which attachments are mandatory. Everything here is enforced server-side;
the vendor form only mirrors it."""

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.bid import Bid, BidAttachmentKind, BidStatus
from app.models.product_master import ProcurementType
from app.models.tender import TenderStatus, TenderType
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TechnicalEvalMethod, TenderLineItem
from app.models.vendor import Vendor, VendorStatus
from app.schemas.bid import DETAILS_BY_TYPE, BidOut, RequirementsOut, SlotOut, AttachmentOut
from app.services.expiry import sweep_vendor

KIND_LABELS = {
    BidAttachmentKind.DATASHEET: "Technical compliance / datasheet document",
    BidAttachmentKind.MANUFACTURER_AUTHORIZATION: "Manufacturer authorization letter",
    BidAttachmentKind.SOW_METHOD: "Proposed SOW / method statement",
    BidAttachmentKind.MANPOWER_PLAN: "Manpower deployment plan",
    BidAttachmentKind.WARRANTY_DOCUMENT: "Warranty document",
    BidAttachmentKind.CERTIFICATION: "Brand / model certification",
    BidAttachmentKind.INSURANCE_PROOF: "Insurance / indemnity proof",
    BidAttachmentKind.PHOTO: "Product / asset photograph",
    BidAttachmentKind.OTHER: "Other supporting document",
}

COMMON_REQUIRED = {
    "unit_price": "Unit price",
    "gst_percent": "GST %",
    "delivery_lead_days": "Delivery lead time (days)",
    "quote_validity_days": "Validity of quote (days)",
}


def shelf_life_tracked(line: TenderLineItem) -> bool:
    return bool((line.product.type_specific_attrs or {}).get("shelf_life_tracking"))


def manpower_applicable(line: TenderLineItem) -> bool:
    return bool((line.product.type_specific_attrs or {}).get("manpower_deployment_norms"))


def compliance_required(line: TenderLineItem) -> bool:
    """Spec 8.2 / 9.2.1: a technical compliance statement is needed for RFP
    tenders and for any line evaluated with technical scoring."""
    return line.tender.tender_type == TenderType.RFP or line.technical_eval_method != TechnicalEvalMethod.QUALIFY_DISQUALIFY


def requirements(line: TenderLineItem, bid: Bid | None) -> RequirementsOut:
    details = (bid.details if bid else None) or {}
    ptype = line.procurement_type
    required = dict(COMMON_REQUIRED)
    slots: list[tuple[BidAttachmentKind, bool]] = []
    need_compliance = compliance_required(line)

    if ptype == ProcurementType.ITEM:
        if shelf_life_tracked(line):
            required["details.shelf_life_months"] = "Shelf life remaining at delivery (months)"
        slots = [(BidAttachmentKind.DATASHEET, need_compliance), (BidAttachmentKind.PHOTO, False), (BidAttachmentKind.OTHER, False)]
    elif ptype == ProcurementType.ASSET:
        required["details.warranty_months"] = "Warranty (months)"
        distributor = bool(details.get("bidding_as_distributor"))
        slots = [
            (BidAttachmentKind.DATASHEET, True),
            (BidAttachmentKind.MANUFACTURER_AUTHORIZATION, distributor),
            (BidAttachmentKind.WARRANTY_DOCUMENT, False),
            (BidAttachmentKind.CERTIFICATION, False),
            (BidAttachmentKind.PHOTO, False),
            (BidAttachmentKind.OTHER, False),
        ]
    else:  # service
        required["details.sow_response"] = "Proposed SOW / method statement"
        slots = [
            (BidAttachmentKind.SOW_METHOD, True),
            (BidAttachmentKind.MANPOWER_PLAN, manpower_applicable(line)),
            (BidAttachmentKind.INSURANCE_PROOF, False),
            (BidAttachmentKind.OTHER, False),
        ]
        if line.tender.tender_type == TenderType.RFP:
            slots.insert(1, (BidAttachmentKind.DATASHEET, True))

    if need_compliance:
        required["technical_compliance"] = "Technical compliance statement"
    return RequirementsOut(
        required_fields=list(required.keys()),
        compliance_required=need_compliance,
        slots=[SlotOut(kind=k, label=KIND_LABELS[k], mandatory=m) for k, m in slots],
    )


def _field_value(bid: Bid, name: str):
    if name.startswith("details."):
        return (bid.details or {}).get(name.split(".", 1)[1])
    return getattr(bid, name)


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def submit_problems(bid: Bid, line: TenderLineItem) -> list[str]:
    """Everything still missing for a bid to be submitted (spec 8.3.1: 'system
    blocks final bid submission until mandatory attachments are present')."""
    req = requirements(line, bid)
    labels = dict(COMMON_REQUIRED)
    labels.update(
        {
            "details.shelf_life_months": "Shelf life remaining at delivery (months)",
            "details.warranty_months": "Warranty (months)",
            "details.sow_response": "Proposed SOW / method statement",
            "technical_compliance": "Technical compliance statement",
        }
    )
    problems = [labels[f] for f in req.required_fields if _blank(_field_value(bid, f))]
    have = {a.kind for a in bid.attachments}
    problems += [f"Attachment: {s.label}" for s in req.slots if s.mandatory and s.kind not in have]
    return problems


def clean_details(line: TenderLineItem, raw: dict) -> dict:
    """Validates the type-specific answers against the line's procurement type."""
    model = DETAILS_BY_TYPE[line.procurement_type]
    try:
        parsed = model(**(raw or {}))
    except Exception as e:  # pydantic ValidationError -> 422 with a readable message
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"details: {e}")
    out = {}
    for k, v in parsed.model_dump().items():
        if isinstance(v, str):
            v = v.strip() or None
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v < 0:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"details.{k} can't be negative")
        if v is not None:
            out[k] = v
    return out


def assert_can_bid(db: Session, vendor: Vendor, line: TenderLineItem) -> None:
    """The gates in front of every bid change (CLAUDE.md PROJECT OVERRIDE;
    spec 5.6 'the most heavily gated function'): Active vendor, published
    tender AND line, deadline not passed, vendor individually invited."""
    if sweep_vendor(db, vendor):  # an expired statutory document suspends the vendor at the moment it matters
        db.commit()
    if vendor.status != VendorStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an Active, approved vendor may bid")
    tender = line.tender
    if tender.status != TenderStatus.PUBLISHED or not line.published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This line is not open for bidding")
    if tender.bid_due_date is None or datetime.now(timezone.utc) > tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The bid deadline for this tender has passed")
    invited = db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id, TenderInvite.vendor_id == vendor.id).first()
    if not invited:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You were not invited to bid on this line item")


def lock_reason(vendor: Vendor, line: TenderLineItem) -> str | None:
    """Why the vendor can only view (no db writes; the gates above do the enforcing)."""
    tender = line.tender
    if vendor.status != VendorStatus.ACTIVE:
        return "Your account is not Active."
    if tender.status != TenderStatus.PUBLISHED or not line.published:
        return "This line is not open for bidding."
    if tender.bid_due_date is None or datetime.now(timezone.utc) > tender.bid_due_date:
        return "The bid deadline has passed. Bids are locked."
    return None


def bid_out(bid: Bid) -> BidOut:
    qty = bid.line_item.qty
    price = bid.unit_price
    landed = None
    if price is not None:
        landed = price * (1 + (bid.gst_percent or 0) / 100) + (bid.other_duties or 0)
    return BidOut(
        id=bid.id,
        status=bid.status,
        unit_price=price,
        gst_percent=bid.gst_percent,
        other_duties=bid.other_duties,
        delivery_lead_days=bid.delivery_lead_days,
        quote_validity_days=bid.quote_validity_days,
        payment_terms=bid.payment_terms,
        technical_compliance=bid.technical_compliance,
        brand_offered=bid.brand_offered,
        details=bid.details or {},
        submitted_at=bid.submitted_at,
        amended_at=bid.amended_at,
        withdrawn_at=bid.withdrawn_at,
        attachments=[AttachmentOut.model_validate(a) for a in bid.attachments],
        total_price=price * qty if price is not None else None,
        landed_unit_price=landed,
        landed_total=landed * qty if landed is not None else None,
    )
