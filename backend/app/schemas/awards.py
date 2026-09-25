from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.product_master import ProcurementType
from app.models.tender import TenderStatus
from app.schemas.evaluation import CommercialRowOut


class AllocationIn(BaseModel):
    bid_id: int
    share_pct: float


class RecommendationSave(BaseModel):
    """mode: confirm_top (the system's L1/C1) | other_vendor (needs bid_id and a
    reason) | split (allocations, Split-Award lines) | exclude (needs a reason)."""

    mode: str
    bid_id: int | None = None
    allocations: list[AllocationIn] | None = None
    reason: str | None = None


class DecisionIn(BaseModel):
    """decision: approve (the Officer's recommendation, optionally with adjusted
    allocations) | award_system_l1 (when the Officer picked someone else) | reject."""

    decision: str
    comments: str | None = None
    allocations: list[AllocationIn] | None = None

    @field_validator("comments")
    @classmethod
    def strip(cls, v):
        return (v or "").strip() or None


class AllocationOut(BaseModel):
    bid_id: int
    vendor_id: int
    vendor_name: str
    share_pct: float
    quantity: float


class RoundOut(BaseModel):
    round_number: int
    status: str
    kind: str
    is_override: bool
    officer_reason: str | None
    system_top_bid_id: int | None
    system_top_vendor: str | None
    proposed: list[AllocationOut]
    final: list[AllocationOut]
    required_tier: int | None
    award_value: float | None
    recommended_by: str | None
    recommended_at: datetime | None
    submitted_at: datetime | None
    decision_kind: str | None
    decided_by: str | None
    decided_at: datetime | None
    decision_comments: str | None


class AwardLineOut(BaseModel):
    line_item_id: int
    product_code: str
    product_name: str
    procurement_type: ProcurementType
    qty: float
    uom: str | None
    split_award_allowed: bool
    evaluation_method: str
    technical_closed: bool
    state: str  # none | draft | pending | approved | excluded | returned
    method: str | None  # "L1" or "QCBS" once prices are open to the viewer
    statement: list[CommercialRowOut] | None  # prices are shown only to those allowed to see them
    current: RoundOut | None
    history: list[RoundOut]
    can_recommend: bool
    can_decide: bool
    min_split_pct: float


class PoFileBrief(BaseModel):
    id: int
    batch_id: str
    vendor_name: str
    version: int
    status: str


class AwardTenderOut(BaseModel):
    tender_id: int
    title: str
    status: TenderStatus
    department: str | None
    facility_name: str
    lines: list[AwardLineOut]
    required_tier: int | None
    pending_value: float
    can_submit: bool
    submit_blockers: list[str]
    po_files: list[PoFileBrief]
    awarded_at: datetime | None


class AwardTenderSummary(BaseModel):
    tender_id: int
    title: str
    status: TenderStatus
    lines_total: int
    counts: dict[str, int]
    required_tier: int | None
    pending_value: float
    waiting_for_you: bool
