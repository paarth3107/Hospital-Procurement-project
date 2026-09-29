from datetime import datetime

from pydantic import BaseModel

from app.models.tender import TenderStatus


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
    pending_vendors: list[DashboardPendingVendorOut]
    docs_to_verify: list[DashboardDocsToVerifyOut]
    award_tasks: list[DashboardAwardTaskOut]
    docs_expiring_count: int
    docs_expired_count: int
    open_tenders: list[DashboardOpenTenderOut]
    pending_approval: list[DashboardPendingApprovalOut]
    recently_published: list[DashboardRecentPublishedOut]
    officer: DashboardOfficerOut | None = None  # populated for Role.PROCUREMENT_OFFICER only
