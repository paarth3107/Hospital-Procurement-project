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
from app.schemas.mapping import MappingOut, VendorMappingRequest
from app.schemas.vendor_portal import PortalLineItemOut, PortalTenderOut
from app.security import get_current_vendor
from app.services.audit import record
from app.services.expiry import sweep_vendor
from app.services.mappings import create_pending_mapping

router = APIRouter(prefix="/api/v1/vendor-portal", tags=["vendor-portal"])


@router.get("/tenders", response_model=list[PortalTenderOut])
def list_open_tenders(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Tenders this vendor was invited to (the resolved eligible-vendor list
    from E-Tender Approval, app/services/eligibility.py -- a persisted
    snapshot, not a live re-check here) that are currently Published."""

    invites = (
        db.query(TenderInvite)
        .join(TenderLineItem, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .join(Tender, TenderLineItem.tender_id == Tender.id)
        .filter(TenderInvite.vendor_id == vendor.id, Tender.status.in_([TenderStatus.PUBLISHED, TenderStatus.AWARDED]))
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
                tender_type=tender.tender_type,
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
