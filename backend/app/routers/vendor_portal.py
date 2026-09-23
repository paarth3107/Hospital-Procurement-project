from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid
from app.models.tender import Tender, TenderStatus
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.vendor import Vendor, VendorStatus
from app.schemas.vendor_portal import BidCreate, BidOut, PortalLineItemOut, PortalTenderOut
from app.security import get_current_vendor

router = APIRouter(prefix="/api/v1/vendor-portal", tags=["vendor-portal"])


def _bid_out(bid: Bid) -> BidOut:
    line_item = bid.line_item
    return BidOut(
        id=bid.id,
        tender_line_item_id=bid.tender_line_item_id,
        unit_price=bid.unit_price,
        status=bid.status,
        submitted_at=bid.submitted_at,
        tender_id=line_item.tender.id,
        tender_title=line_item.tender.title,
        product_name=line_item.product.name,
        qty=line_item.qty,
    )


@router.get("/tenders", response_model=list[PortalTenderOut])
def list_open_tenders(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Tenders this vendor was invited to (the resolved eligible-vendor list
    from E-Tender Approval, app/services/eligibility.py -- a persisted
    snapshot, not a live re-check here) that are currently Published."""

    invites = (
        db.query(TenderInvite)
        .join(TenderLineItem, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .join(Tender, TenderLineItem.tender_id == Tender.id)
        .filter(TenderInvite.vendor_id == vendor.id, Tender.status == TenderStatus.PUBLISHED)
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
        can_bid = tender.bid_due_date is not None and now <= tender.bid_due_date
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


@router.get("/bids", response_model=list[BidOut])
def list_my_bids(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    bids = db.query(Bid).filter(Bid.vendor_id == vendor.id).order_by(Bid.submitted_at.desc()).all()
    return [_bid_out(b) for b in bids]


@router.post("/bids", response_model=BidOut, status_code=status.HTTP_201_CREATED)
def submit_bid(payload: BidCreate, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Spec §5.6: "the most heavily gated function in the system" -- every
    check here is server-side and independent of anything the client
    claims, per CLAUDE.md's PROJECT OVERRIDE and the spec's own emphasis."""

    if vendor.status != VendorStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an Active, approved vendor may submit a bid")

    line_item = db.get(TenderLineItem, payload.tender_line_item_id)
    if not line_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender line item not found")

    tender = line_item.tender
    if tender.status != TenderStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This tender is not open for bidding")
    if tender.bid_due_date is None or datetime.now(timezone.utc) > tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The bid deadline for this tender has passed")

    invited = (
        db.query(TenderInvite)
        .filter(TenderInvite.tender_line_item_id == line_item.id, TenderInvite.vendor_id == vendor.id)
        .first()
    )
    if not invited:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You were not invited to bid on this line item")

    existing = db.query(Bid).filter(Bid.tender_line_item_id == line_item.id, Bid.vendor_id == vendor.id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already submitted a bid for this line item")

    if payload.unit_price <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unit price must be a positive number")

    bid = Bid(tender_line_item_id=line_item.id, vendor_id=vendor.id, unit_price=payload.unit_price)
    db.add(bid)
    db.commit()
    db.refresh(bid)
    return _bid_out(bid)
