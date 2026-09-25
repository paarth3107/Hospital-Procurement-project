from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid, BidStatus
from app.models.tender import Tender, TenderStatus
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound
from app.models.product_master import ProductMaster
from app.models.tender_line_item import TenderLineItem
from app.models.vendor_mapping import MappingState, VendorMapping
from app.models.vendor_rating import VendorRating
from app.models.user_account import UserAccount
from app.models.vendor import DocumentStatus, Vendor, VendorDocument, VendorStatus, VendorStatusHistory
from app.schemas.dashboard import (
    DashboardHeldLineOut,
    DashboardOpenTenderOut,
    DashboardPendingApprovalOut,
    DashboardDocsToVerifyOut,
    DashboardPendingVendorOut,
    DashboardRecentPublishedOut,
    DashboardStatsOut,
)
from app.security import get_current_user
from app.services.approval_matrix import can_approve_tier

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


def _live_expiry_docs(db: Session):
    """Documents with an expiry date that belong to vendors still in play."""
    return (
        db.query(VendorDocument)
        .join(Vendor, Vendor.id == VendorDocument.vendor_id)
        .filter(
            VendorDocument.valid_till.isnot(None),
            VendorDocument.status != DocumentStatus.REJECTED,
            Vendor.status.in_([VendorStatus.ACTIVE, VendorStatus.SUSPENDED]),
        )
        .all()
    )


@router.get("/stats", response_model=DashboardStatsOut)
def get_dashboard_stats(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Real, computed-on-request numbers only -- no Award/PO phase exists
    yet, so there's deliberately no "Awarded This Month" stat here (that
    would just be decoration pretending to be data); Bids Submitted stands
    in as the equivalent "recent activity" figure that's actually real."""

    now = datetime.now(timezone.utc)

    open_tenders = (
        db.query(Tender)
        .filter(Tender.status == TenderStatus.PUBLISHED, Tender.bid_due_date > now)
        .order_by(Tender.bid_due_date)
        .all()
    )
    bid_counts = dict(
        db.query(TenderLineItem.tender_id, func.count(Bid.id))
        .join(Bid, Bid.tender_line_item_id == TenderLineItem.id)
        .filter(Bid.status == BidStatus.SUBMITTED)
        .group_by(TenderLineItem.tender_id)
        .all()
    )

    pending_approval_all = db.query(Tender).filter(Tender.status == TenderStatus.PENDING_APPROVAL).all()
    rounds_by_tender = {
        r.tender_id: r
        for r in db.query(TenderApprovalRound).filter(
            TenderApprovalRound.tender_id.in_([t.id for t in pending_approval_all]),
            TenderApprovalRound.decision == RoundDecision.PENDING,
        )
    }
    pending_your_approval = [
        (t, rounds_by_tender[t.id])
        for t in pending_approval_all
        if t.id in rounds_by_tender and can_approve_tier(user, rounds_by_tender[t.id].required_tier)
    ]

    # Only Pending Verification is work for the admin; Info Requested is
    # waiting on the vendor (it comes back here when they respond).
    pending_vendor_rows = (
        db.query(Vendor).filter(Vendor.status == VendorStatus.PENDING_VERIFICATION).order_by(Vendor.created_at).all()
    )
    vendors_pending_count = len(pending_vendor_rows)
    responded_ids = {
        vid
        for (vid,) in db.query(VendorStatusHistory.vendor_id).filter(
            VendorStatusHistory.vendor_id.in_([v.id for v in pending_vendor_rows]),
            VendorStatusHistory.from_status == VendorStatus.INFO_REQUESTED,
            VendorStatusHistory.to_status == VendorStatus.PENDING_VERIFICATION,
        )
    }
    registered_vendors_count = db.query(Vendor).count()
    # Documents uploaded by vendors who are already Active/Suspended (e.g. answering a
    # newly added item requirement): nothing else in the queue would surface them.
    docs_to_verify = [
        DashboardDocsToVerifyOut(vendor_id=vid, legal_name=name, count=n)
        for vid, name, n in db.query(Vendor.id, Vendor.legal_name, func.count(VendorDocument.id))
        .join(VendorDocument, VendorDocument.vendor_id == Vendor.id)
        .filter(VendorDocument.status == DocumentStatus.PENDING, Vendor.status.in_([VendorStatus.ACTIVE, VendorStatus.SUSPENDED]))
        .group_by(Vendor.id, Vendor.legal_name)
        .order_by(Vendor.legal_name)
        .all()
    ]
    bids_submitted_count = db.query(Bid).filter(Bid.status == BidStatus.SUBMITTED).count()

    recently_published = (
        db.query(Tender)
        .filter(Tender.status == TenderStatus.PUBLISHED, Tender.published_at.isnot(None))
        .order_by(Tender.published_at.desc())
        .limit(5)
        .all()
    )

    vendors_by_status = {
        status.value: count for status, count in db.query(Vendor.status, func.count(Vendor.id)).group_by(Vendor.status).all()
    }
    published_tenders = db.query(Tender).filter(Tender.status == TenderStatus.PUBLISHED).all()
    published_lines = [li for t in published_tenders for li in t.line_items]
    held_lines = [li for li in published_lines if not li.published]

    return DashboardStatsOut(
        vendors_by_status=vendors_by_status,
        catalog_entries_count=db.query(ProductMaster).filter(ProductMaster.active.is_(True)).count(),
        mappings_approved_count=db.query(VendorMapping).filter(VendorMapping.state == MappingState.APPROVED).count(),
        mappings_pending_count=db.query(VendorMapping).filter(VendorMapping.state == MappingState.PENDING).count(),
        lines_total=len(published_lines),
        lines_published=len(published_lines) - len(held_lines),
        last_rating_update=db.query(func.max(VendorRating.last_manual_update_at)).scalar(),
        next_bid_close=open_tenders[0].bid_due_date if open_tenders else None,
        docs_expiring_count=sum(1 for d in _live_expiry_docs(db) if d.expiry_state == "expiring"),
        docs_expired_count=sum(1 for d in _live_expiry_docs(db) if d.expiry_state == "expired"),
        docs_to_verify=docs_to_verify,
        pending_vendors=[DashboardPendingVendorOut(id=v.id, legal_name=v.legal_name, responded=v.id in responded_ids) for v in pending_vendor_rows[:10]],
        held_lines=[
            DashboardHeldLineOut(tender_id=li.tender.id, tender_title=li.tender.title, product_name=li.product.name)
            for li in held_lines[:5]
        ],
        open_tenders_count=len(open_tenders),
        pending_approval_count=len(pending_your_approval),
        vendors_pending_count=vendors_pending_count,
        registered_vendors_count=registered_vendors_count,
        bids_submitted_count=bids_submitted_count,
        open_tenders=[
            DashboardOpenTenderOut(
                id=t.id,
                title=t.title,
                department=t.department,
                bids_received=bid_counts.get(t.id, 0),
                bid_due_date=t.bid_due_date,
                status=t.status,
            )
            for t in open_tenders[:5]
        ],
        pending_approval=[
            DashboardPendingApprovalOut(id=t.id, title=t.title, round_number=t.round_number, required_tier=r.required_tier)
            for t, r in pending_your_approval[:5]
        ],
        recently_published=[
            DashboardRecentPublishedOut(id=t.id, title=t.title, published_at=t.published_at) for t in recently_published
        ],
    )
