from datetime import datetime

from pydantic import BaseModel

from app.models.product_master import ProcurementType
from app.models.tender import TenderStatus


class DashboardDraftTenderOut(BaseModel):
    id: int
    title: str
    line_count: int
    created_at: datetime


class DashboardOpenTenderOut(BaseModel):
    id: int
    title: str
    department: str | None
    bids_received: int
    bid_due_date: datetime | None
    status: TenderStatus


class DashboardPendingApprovalOut(BaseModel):
    id: int
    title: str
    round_number: int
    required_tier: int


class DashboardRecentPublishedOut(BaseModel):
    id: int
    title: str
    published_at: datetime | None


class DashboardHeldLineOut(BaseModel):
    tender_id: int
    tender_title: str
    product_name: str


class DashboardPendingVendorOut(BaseModel):
    id: int
    legal_name: str
    responded: bool  # True = answering an Info Requested, False = a new registration


class DashboardDocsToVerifyOut(BaseModel):
    vendor_id: int
    legal_name: str
    count: int


class DashboardPendingMappingOut(BaseModel):
    """One pending vendor<->catalog eligibility request -- itemized (like the
    KYC tasks) instead of a single "review N" aggregate line, 2026-09-30."""

    id: int
    vendor_id: int
    vendor_name: str
    target_kind: str  # "item" | "category"
    target_name: str
    requested_at: datetime


class DashboardEvalWorkloadOut(BaseModel):
    """A published line whose bidding closed but nobody's closed technical
    evaluation yet. Only lines with real bids ever reach here -- a zero-bid
    line auto-closes itself before this is computed (sweep_no_bid_lines)."""

    line_item_id: int
    tender_id: int
    tender_title: str
    product_name: str
    submitted_count: int
    bid_due_date: datetime


class DashboardStaleRatingOut(BaseModel):
    """Spec §5.3.1 point 5: a vendor's manually-entered rating parameters
    haven't been refreshed in over 90 days (VendorRating.is_stale)."""

    vendor_id: int
    vendor_name: str
    procurement_type: ProcurementType
    last_manual_update_at: datetime
    days_since_update: int


class DashboardAwardTaskOut(BaseModel):
    tender_id: int
    title: str
    kind: str  # recommend | decide
    lines: int
    tier: int | None
    detail: str


class DashboardOfficerTenderOut(BaseModel):
    """One row of the Officer's own "Tenders" table -- Draft/Pending Approval/
    Published only; awarded/closed tenders drop off (nothing left to do)."""

    id: int
    title: str
    status: TenderStatus
    bids_received: int
    bid_due_date: datetime | None
    lines_ready_to_recommend: int
    lines_awaiting_decision: int
    lines_total: int
    progress_pct: int  # milestone-based progress through the tender's lifecycle, see _tender_progress_pct


class DashboardOfficerOut(BaseModel):
    """Procurement Officer's own pipeline: only stages the Officer can act on
    or is directly waiting on (spec has no dashboard requirements -- this is a
    product decision, 2026-09-29). Vendor registration/mapping/rating-refresh
    (Category Manager's job) are deliberately absent, and "technical
    evaluation in progress" is deliberately not a stage here -- there's
    nothing for the Officer to do until it closes and lines show up in
    ready_to_recommend."""

    draft_count: int
    pending_approval_count: int
    live_count: int  # Published AND still before its bid due date
    awaiting_evaluation_close_count: int  # Published, deadline passed, Category Manager hasn't closed technical evaluation yet (0 bids or not)
    ready_to_recommend_count: int  # tenders with >=1 line ready
    ready_to_recommend_lines: int
    awaiting_decision_count: int  # tenders with >=1 line submitted, decision pending
    awaiting_decision_lines: int
    tenders: list[DashboardOfficerTenderOut]


class DashboardApprovingAuthorityTenderOut(BaseModel):
    """One row of the Approving Authority's own "Tenders" table -- Pending
    E-Tender Approval and Published only (mirrors the Officer's table);
    Awarded/No Award tenders drop off (nothing left to decide)."""

    id: int
    title: str
    status: TenderStatus
    bids_received: int
    bid_due_date: datetime | None
    needs_your_approval: bool  # Pending E-Tender Approval, and at this user's decidable tier
    required_tier: int | None  # the tier that tender's current round actually needs, whether or not it's this user's
    lines_ready_to_recommend: int  # Published: lines technically closed, waiting on the Officer (tracking only)
    lines_awaiting_decision: int  # Published: lines recommended and waiting on this user's L1 decision
    lines_total: int
    progress_pct: int


class DashboardApprovingAuthorityOut(BaseModel):
    """Approving Authority's own pipeline: the two gates this role decides --
    E-Tender Approval and L1 Approval (product decision, 2026-10-07, mirrors
    the Officer's dashboard). Draft tenders and the Officer's own
    recommendation work are tracked only as notes, not their own KPI, since
    this role can't act on either."""

    pending_approval_count: int  # tenders awaiting this user's E-Tender Approval decision, right now
    live_count: int  # Published AND still before its bid due date
    ready_to_recommend_count: int  # tenders with >=1 line ready for the Officer to recommend (tracking)
    ready_to_recommend_lines: int
    awaiting_decision_count: int  # tenders with >=1 line awaiting this user's L1 decision
    awaiting_decision_lines: int
    tenders: list[DashboardApprovingAuthorityTenderOut]


class DashboardCategoryManagerOut(BaseModel):
    """Category Manager / Procurement Admin's own slice of the tender
    lifecycle (product decision, 2026-10-07): just the technical-evaluation
    stage this role actually touches, framed as a mini pipeline the same way
    the Officer's and Approving Authority's dashboards frame theirs. Vendor
    KYC, mapping and rating refresh stay as separate queues (actionQueue.js)
    -- they're parallel work, not steps of one tender's lifecycle, so they
    don't belong in this pipeline."""

    live_count: int  # Published tenders still accepting bids -- not yet this role's job, tracking only
    awaiting_evaluation_count: int  # lines whose bidding closed, technical evaluation not yet closed -- this role's job (= eval_workload)
    evaluated_count: int  # lines technical-closed, now with the Officer for recommendation -- tracking only


class DashboardStatsOut(BaseModel):
    open_tenders_count: int
    pending_approval_count: int
    vendors_pending_count: int
    registered_vendors_count: int
    bids_submitted_count: int
    # Pipeline / vendor-base / header numbers (real counts only)
    vendors_by_status: dict[str, int]
    catalog_entries_count: int
    mappings_approved_count: int
    mappings_pending_count: int
    lines_total: int
    lines_published: int
    last_rating_update: datetime | None
    next_bid_close: datetime | None
    held_lines: list[DashboardHeldLineOut]
    draft_tenders: list[DashboardDraftTenderOut]  # need to be completed and submitted for approval -- real work, not just an FYI
    pending_vendors: list[DashboardPendingVendorOut]
    docs_to_verify: list[DashboardDocsToVerifyOut]
    pending_mappings: list[DashboardPendingMappingOut]
    eval_workload: list[DashboardEvalWorkloadOut]
    stale_ratings: list[DashboardStaleRatingOut]
    award_tasks: list[DashboardAwardTaskOut]
    docs_expiring_count: int
    docs_expired_count: int
    open_tenders: list[DashboardOpenTenderOut]
    pending_approval: list[DashboardPendingApprovalOut]
    recently_published: list[DashboardRecentPublishedOut]
    officer: DashboardOfficerOut | None = None  # populated for Role.PROCUREMENT_OFFICER only
    approving_authority: DashboardApprovingAuthorityOut | None = None  # populated for Role.APPROVING_AUTHORITY only
    category_manager: DashboardCategoryManagerOut | None = None  # populated for Role.CATEGORY_MANAGER / Role.PROCUREMENT_ADMIN only
