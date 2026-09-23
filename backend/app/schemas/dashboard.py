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


class DashboardStatsOut(BaseModel):
    open_tenders_count: int
    pending_approval_count: int
    vendors_pending_count: int
    registered_vendors_count: int
    bids_submitted_count: int
    open_tenders: list[DashboardOpenTenderOut]
    pending_approval: list[DashboardPendingApprovalOut]
    recently_published: list[DashboardRecentPublishedOut]
