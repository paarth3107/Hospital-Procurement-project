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


class DashboardPoFileOut(BaseModel):
    id: int
    batch_id: str
    vendor_name: str


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
    po_files_pending: list[DashboardPoFileOut]
    docs_expiring_count: int
    docs_expired_count: int
    open_tenders: list[DashboardOpenTenderOut]
    pending_approval: list[DashboardPendingApprovalOut]
    recently_published: list[DashboardRecentPublishedOut]
