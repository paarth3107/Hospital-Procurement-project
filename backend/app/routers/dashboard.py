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
from app.models.user_account import Role, UserAccount
from app.models.vendor import DocumentStatus, Vendor, VendorDocument, VendorStatus, VendorStatusHistory
from app.schemas.dashboard import (
    DashboardDraftTenderOut,
    DashboardEvalWorkloadOut,
    DashboardHeldLineOut,
    DashboardOfficerOut,
    DashboardOfficerTenderOut,
    DashboardOpenTenderOut,
    DashboardPendingApprovalOut,
    DashboardPendingMappingOut,
    DashboardAwardTaskOut,
    DashboardDocsToVerifyOut,
    DashboardPendingVendorOut,
    DashboardRecentPublishedOut,
    DashboardStaleRatingOut,
    DashboardStatsOut,
)
from app.security import get_current_user
from app.services import awards as award_rules
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


def _officer_stats(
    db: Session, user: UserAccount, award_tasks_raw: list[dict], pending_approval_count: int, bid_counts: dict[int, int], draft_tenders: list[Tender]
) -> DashboardOfficerOut | None:
    """Procurement Officer's own tender-lifecycle pipeline (product decision,
    2026-09-29 -- the spec has no dashboard requirements). Deliberately
    excludes Category Manager's stages (vendor registration, mapping, rating
    refresh) and "technical evaluation in progress" -- the Officer has nothing
    actionable there; a line shows up here once it lands in
    ready_to_recommend."""
    if user.role != Role.PROCUREMENT_OFFICER:
        return None

    draft_count = len(draft_tenders)

    recommend_by_tender = {t["tender_id"]: t["lines"] for t in award_tasks_raw if t["kind"] == "recommend"}
    decision_by_tender: dict[int, int] = {}
    for t, _li in award_rules.awaiting_decision(db):
        decision_by_tender[t.id] = decision_by_tender.get(t.id, 0) + 1

    tenders = (
        db.query(Tender)
        .filter(Tender.status.in_([TenderStatus.DRAFT, TenderStatus.PENDING_APPROVAL, TenderStatus.PUBLISHED]))
        .order_by(Tender.id.desc())
        .all()
    )
    now = datetime.now(timezone.utc)
    # "Live" = still genuinely accepting bids. A Published tender whose
    # deadline has passed but hasn't moved anywhere (Category Manager hasn't
    # closed technical evaluation on it yet -- true whether it got 0 bids or
    # 50) is neither live nor recommendable yet, so it's tracked separately
    # rather than silently miscounted as "bidding open".
    published = [t for t in tenders if t.status == TenderStatus.PUBLISHED]
    live_count = sum(1 for t in published if t.bid_due_date is None or t.bid_due_date > now)
    awaiting_evaluation_close_count = sum(
        1 for t in published
        if t.bid_due_date is not None and t.bid_due_date <= now and t.id not in recommend_by_tender and t.id not in decision_by_tender
    )

    return DashboardOfficerOut(
        draft_count=draft_count,
        pending_approval_count=pending_approval_count,
        live_count=live_count,
        awaiting_evaluation_close_count=awaiting_evaluation_close_count,
        ready_to_recommend_count=len(recommend_by_tender),
        ready_to_recommend_lines=sum(recommend_by_tender.values()),
        awaiting_decision_count=len(decision_by_tender),
        awaiting_decision_lines=sum(decision_by_tender.values()),
        tenders=[
            DashboardOfficerTenderOut(
                id=t.id, title=t.title, status=t.status, bids_received=bid_counts.get(t.id, 0), bid_due_date=t.bid_due_date,
                lines_ready_to_recommend=recommend_by_tender.get(t.id, 0), lines_awaiting_decision=decision_by_tender.get(t.id, 0),
            )
            for t in tenders
        ],
    )


@router.get("/stats", response_model=DashboardStatsOut)
def get_dashboard_stats(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Real, computed-on-request numbers only -- no Award/PO phase exists
    yet, so there's deliberately no "Awarded This Month" stat here (that
    would just be decoration pretending to be data); Bids Submitted stands
    in as the equivalent "recent activity" figure that's actually real."""

    award_rules.sweep_no_bid_lines(db)  # at the moment it matters: this is what "still Published" claims are read from
    now = datetime.now(timezone.utc)

    draft_tenders = db.query(Tender).filter(Tender.status == TenderStatus.DRAFT).order_by(Tender.created_at).all()

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

    award_tasks_raw = award_rules.tasks_for(db, user)

    # Category Manager's own queues (product decision, 2026-09-30): itemized
    # like the KYC tasks, instead of a single aggregate count each.
    pending_mapping_rows = db.query(VendorMapping).filter(VendorMapping.state == MappingState.PENDING).order_by(VendorMapping.requested_at).all()
    pending_mappings = [
        DashboardPendingMappingOut(
            id=m.id, vendor_id=m.vendor_id, vendor_name=m.vendor.legal_name,
            target_kind="item" if m.product_master_id else "category",
            target_name=m.product.name if m.product_master_id else m.category.name,
            requested_at=m.requested_at,
        )
        for m in pending_mapping_rows
    ]

    # A line whose bidding closed but technical evaluation hasn't been closed
    # yet -- a zero-bid line never reaches here, sweep_no_bid_lines() (above)
    # already closed it out before this query runs.
    eval_workload_lines = (
        db.query(TenderLineItem)
        .join(Tender, TenderLineItem.tender_id == Tender.id)
        .filter(
            Tender.status == TenderStatus.PUBLISHED, TenderLineItem.published.is_(True),
            Tender.bid_due_date.isnot(None), Tender.bid_due_date <= now, TenderLineItem.technical_closed_at.is_(None),
        )
        .order_by(Tender.bid_due_date)
        .all()
    )
    eval_bid_counts = dict(
        db.query(Bid.tender_line_item_id, func.count(Bid.id))
        .filter(Bid.tender_line_item_id.in_([li.id for li in eval_workload_lines]), Bid.status == BidStatus.SUBMITTED)
        .group_by(Bid.tender_line_item_id)
        .all()
    ) if eval_workload_lines else {}
    eval_workload = [
        DashboardEvalWorkloadOut(
            line_item_id=li.id, tender_id=li.tender.id, tender_title=li.tender.title, product_name=li.product.name,
            submitted_count=eval_bid_counts.get(li.id, 0), bid_due_date=li.tender.bid_due_date,
        )
        for li in eval_workload_lines
    ]

    stale_rating_rows = [r for r in db.query(VendorRating).all() if r.is_stale]
    stale_ratings = [
        DashboardStaleRatingOut(
            vendor_id=r.vendor_id, vendor_name=r.vendor.legal_name, procurement_type=r.procurement_type,
            last_manual_update_at=r.last_manual_update_at, days_since_update=(now - r.last_manual_update_at).days,
        )
        for r in stale_rating_rows
    ]

    return DashboardStatsOut(
        officer=_officer_stats(db, user, award_tasks_raw, len(pending_approval_all), bid_counts, draft_tenders),
        vendors_by_status=vendors_by_status,
        catalog_entries_count=db.query(ProductMaster).filter(ProductMaster.active.is_(True)).count(),
        mappings_approved_count=db.query(VendorMapping).filter(VendorMapping.state == MappingState.APPROVED).count(),
        mappings_pending_count=len(pending_mapping_rows),
        lines_total=len(published_lines),
        lines_published=len(published_lines) - len(held_lines),
        last_rating_update=db.query(func.max(VendorRating.last_manual_update_at)).scalar(),
        next_bid_close=open_tenders[0].bid_due_date if open_tenders else None,
        docs_expiring_count=sum(1 for d in _live_expiry_docs(db) if d.expiry_state == "expiring"),
        docs_expired_count=sum(1 for d in _live_expiry_docs(db) if d.expiry_state == "expired"),
        docs_to_verify=docs_to_verify,
        award_tasks=[DashboardAwardTaskOut(**t) for t in award_tasks_raw],
        pending_vendors=[DashboardPendingVendorOut(id=v.id, legal_name=v.legal_name, responded=v.id in responded_ids) for v in pending_vendor_rows[:10]],
        held_lines=[
            DashboardHeldLineOut(tender_id=li.tender.id, tender_title=li.tender.title, product_name=li.product.name)
            for li in held_lines[:5]
        ],
        draft_tenders=[
            DashboardDraftTenderOut(id=t.id, title=t.title, line_count=len(t.line_items), created_at=t.created_at) for t in draft_tenders
        ],
        pending_mappings=pending_mappings,
        eval_workload=eval_workload,
        stale_ratings=stale_ratings,
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
