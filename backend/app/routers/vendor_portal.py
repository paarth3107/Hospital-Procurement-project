from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid
from app.models.tender import Tender, TenderStatus
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_mapping import VendorMapping
from app.models.vendor_rating import VendorRating
from app.schemas.mapping import MappingOut, VendorMappingRequest
from app.schemas.rating import RatingOut
from app.schemas.vendor import VendorCommercialTermsUpdate, VendorOut
from app.schemas.vendor_portal import PortalLineItemOut, PortalTenderOut
from app.security import get_current_vendor
from app.services.audit import record
from app.services.expiry import sweep_vendor
from app.services.mappings import create_pending_mapping
from app.services.open_links import facility_name, link_state
from app.schemas.open_link import RegisteredTenderOut

router = APIRouter(prefix="/api/v1/vendor-portal", tags=["vendor-portal"])


@router.put("/commercial-terms", response_model=VendorOut)
def update_commercial_terms(payload: VendorCommercialTermsUpdate, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """No longer collected at registration (optional, spec §3.2) -- a vendor
    can set or change these any time from Company profile instead. Purely
    informational (shown to staff, never gates anything), so no approval
    needed, unlike everything document/mapping-related."""

    before = {"payment_terms": vendor.payment_terms, "delivery_lead_time_days": vendor.delivery_lead_time_days, "min_order_value": vendor.min_order_value}
    vendor.payment_terms = payload.payment_terms
    vendor.delivery_lead_time_days = payload.delivery_lead_time_days
    vendor.min_order_value = payload.min_order_value
    after = {"payment_terms": vendor.payment_terms, "delivery_lead_time_days": vendor.delivery_lead_time_days, "min_order_value": vendor.min_order_value}
    record(db, "vendor.commercial_terms_updated", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name, before=before, after=after)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.get("/ratings", response_model=list[RatingOut])
def my_ratings(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Spec §5: a vendor's own rating, so it isn't a black box -- it's what
    the eligibility resolver actually filters invitations on. Unlike the
    staff endpoint (get_or_create_rating), this never lazily creates a row:
    a procurement type the vendor has never been rated in just doesn't
    appear, rather than fabricating a provisional one on the fly."""
    return db.query(VendorRating).filter(VendorRating.vendor_id == vendor.id).order_by(VendorRating.procurement_type).all()


@router.get("/tenders", response_model=list[PortalTenderOut])
def list_open_tenders(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Tenders this vendor was invited to (the resolved eligible-vendor list
    from E-Tender Approval, app/services/eligibility.py -- a persisted
    snapshot, not a live re-check here) that are currently Published."""

    invites = (
        db.query(TenderInvite)
        .join(TenderLineItem, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .join(Tender, TenderLineItem.tender_id == Tender.id)
        .filter(TenderInvite.vendor_id == vendor.id, Tender.status.in_([TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD]))
        .all()
    )
    if not invites:
        return []

    line_item_ids = [inv.tender_line_item_id for inv in invites]
    bids_by_line_item = {
        b.tender_line_item_id: b
        for b in db.query(Bid).filter(Bid.vendor_id == vendor.id, Bid.tender_line_item_id.in_(line_item_ids)).all()
    }

    tenders: dict[int, Tender] = {}
    lines_by_tender: dict[int, list[TenderLineItem]] = {}
    for inv in invites:
        li = inv.line_item
        tenders[li.tender_id] = li.tender
        lines_by_tender.setdefault(li.tender_id, []).append(li)

    now = datetime.now(timezone.utc)
    results = []
    for tender_id, tender in tenders.items():
        can_bid = vendor.status == VendorStatus.ACTIVE and tender.bid_due_date is not None and now <= tender.bid_due_date
        line_items_out = [
            PortalLineItemOut(
                line_item_id=li.id,
                product_name=li.product.name,
                qty=li.qty,
                already_bid=li.id in bids_by_line_item,
                bid_status=bids_by_line_item[li.id].status if li.id in bids_by_line_item else None,
            )
            for li in lines_by_tender[tender_id]
        ]
        results.append(
            PortalTenderOut(
                tender_id=tender.id,
                title=tender.title,
                facility_name=tender.facility.name,
                tender_type=tender.tender_type,
                status=tender.status,
                bid_due_date=tender.bid_due_date,
                can_bid=can_bid,
                line_items=line_items_out,
            )
        )
    return results


@router.get("/mappings", response_model=list[MappingOut])
def list_my_mappings(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """A vendor's own mapping requests -- there was previously no way for
    a logged-in vendor to see their own request/approval status at all
    (GET /mappings is staff-only); the Categories tab needs this to tell
    Approved (locked) apart from everything else (still requestable)."""

    return (
        db.query(VendorMapping)
        .filter(VendorMapping.vendor_id == vendor.id)
        .order_by(VendorMapping.requested_at.desc())
        .all()
    )


@router.post("/mappings", response_model=MappingOut, status_code=status.HTTP_201_CREATED)
def request_my_mapping(
    payload: VendorMappingRequest, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)
):
    """A vendor requests a category mapping or an item mapping for
    themselves -- the vendor is always the logged-in one."""

    return create_pending_mapping(db, vendor, payload.product_master_id, payload.category_id, require_uploaded_documents=True, requested_by=vendor)


@router.get("/registered-tender", response_model=RegisteredTenderOut | None)
def registered_tender(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """The Open Tender this vendor registered through, shown to them while they
    wait for approval so they can see it listed (2026-10-06)."""

    tender = db.get(Tender, vendor.registered_via_tender_id) if vendor.registered_via_tender_id else None
    if tender is None:
        return None
    return RegisteredTenderOut(
        id=tender.id,
        title=tender.title,
        facility_name=facility_name(tender, db),
        department=tender.department,
        bid_due_date=tender.bid_due_date,
        state=link_state(tender),
        tender_status=tender.status.value,
    )
