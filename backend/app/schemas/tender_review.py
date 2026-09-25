from datetime import datetime

from pydantic import BaseModel

from app.models.product_master import ProcurementType
from app.models.tender import TenderStatus, TenderType
from app.models.tender_approval_round import RoundDecision
from app.models.tender_line_item import TechnicalEvalMethod


class ReviewVendorOut(BaseModel):
    vendor_id: int
    legal_name: str
    rating_score: float


class ReviewLineOut(BaseModel):
    line_item_id: int
    product_code: str
    product_name: str
    category: str
    procurement_type: ProcurementType
    regulatory_class: str | None
    uom: str | None
    qty: float
    estimated_price: float | None
    line_value: float | None
    split_award_allowed: bool
    technical_eval_method: TechnicalEvalMethod
    technical_weight: float | None
    price_weight: float | None
    min_rating_applied: float
    line_details: dict
    catalog_attrs: dict
    required_documents: list[str]
    eligible_vendors: list[ReviewVendorOut]  # live resolution: what approving will publish to
    held_back: bool  # no eligible vendor: the line will not be published


class ReviewRoundOut(BaseModel):
    round_number: int
    decision: RoundDecision
    required_tier: int
    submitted_by: str | None
    submitted_at: datetime | None
    reviewer: str | None
    decided_at: datetime | None
    comments: str | None


class TenderReviewOut(BaseModel):
    id: int
    title: str
    description: str | None
    tender_type: TenderType
    status: TenderStatus
    department: str | None
    facility_name: str
    facility_code: str | None
    min_rating_threshold: float
    min_invites: int | None
    max_invites: int | None
    publish_date: datetime | None
    bid_due_date: datetime | None
    created_by: str | None
    created_at: datetime
    round_number: int
    consecutive_rejections: int
    total_estimated_value: float
    lines_without_price: int
    required_tier: int | None
    tier_label: str | None
    escalated: bool
    can_decide: bool  # the viewer may approve/reject this tender at its required tier
    warnings: list[str]
    rounds: list[ReviewRoundOut]
    lines: list[ReviewLineOut]
