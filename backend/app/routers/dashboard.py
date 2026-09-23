from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid
from app.models.tender import Tender, TenderStatus
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound
from app.models.tender_line_item import TenderLineItem
from app.models.user_account import UserAccount
from app.models.vendor import Vendor, VendorStatus
from app.schemas.dashboard import (
    DashboardOpenTenderOut,
    DashboardPendingApprovalOut,
    DashboardRecentPublishedOut,
    DashboardStatsOut,
)
from app.security import get_current_user
from app.services.approval_matrix import can_approve_tier

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


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

    vendors_pending_count = (
        db.query(Vendor)
        .filter(Vendor.status.in_([VendorStatus.PENDING_VERIFICATION, VendorStatus.INFO_REQUESTED]))
        .count()
    )
    registered_vendors_count = db.query(Vendor).count()
    bids_submitted_count = db.query(Bid).count()

    recently_published = (
        db.query(Tender)
        .filter(Tender.status == TenderStatus.PUBLISHED, Tender.published_at.isnot(None))
        .order_by(Tender.published_at.desc())
        .limit(5)
        .all()
    )

    return DashboardStatsOut(
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
