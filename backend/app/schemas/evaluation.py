from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.bid import BidAttachmentKind
from app.models.bid_evaluation import TechnicalDecision
from app.models.product_master import ProcurementType
from app.models.tender import TenderType
from app.models.tender_line_item import TechnicalEvalMethod


class LineSummaryOut(BaseModel):
    line_item_id: int
    tender_id: int
    tender_title: str
    tender_type: TenderType
    product_name: str
    procurement_type: ProcurementType
    qty: float
    bid_due_date: datetime | None
    technical_eval_method: TechnicalEvalMethod
    phase: str  # bidding_open | technical_evaluation | technical_closed
    invited_count: int
    submitted_count: int
    evaluated_count: int


class CriterionOut(BaseModel):
    key: str
    label: str
    weight: float
    auto: bool
    optional: bool


class AttachmentMetaOut(BaseModel):
    id: int
    kind: BidAttachmentKind
    label: str
    original_filename: str
    size_bytes: int
    description: str | None


class EvaluationOut(BaseModel):
    evaluator: str
    mine: bool
    decision: TechnicalDecision
    scores: dict
    weighted_score: float | None
    comments: str | None


class ResultOut(BaseModel):
    outcome: TechnicalDecision
    consolidated_score: float | None
    t_rank: int | None
    reason: str | None


class TechnicalContentOut(BaseModel):
    """What a technical evaluator may see of a bid: the technical envelope
    only. Unit price, taxes, delivery lead time, quote validity and payment
    terms (the commercial envelope) are never included (spec 9.2.4, 9.6)."""

    brand_offered: str | None
    technical_compliance: str | None
    details: dict
    attachments: list[AttachmentMetaOut]


class ReviewAttachmentOut(AttachmentMetaOut):
    opened: bool  # this evaluator has opened the file


class BidReviewOut(BaseModel):
    """The technical envelope of one bid, for the evaluator who opens it to
    score it. Served only to evaluators, after the deadline. Commercial fields
    are never included."""

    bid_id: int
    vendor_name: str
    rating: float
    brand_offered: str | None
    technical_compliance: str | None
    details: dict
    attachments: list[ReviewAttachmentOut]
    all_opened: bool  # scoring stays locked until every attachment has been opened
    criteria: list[CriterionOut]
    min_technical_score: float
    scored: bool  # technically scored line: bids will also be T-ranked
    my_evaluation: EvaluationOut | None


class VendorBidRow(BaseModel):
    vendor_id: int
    vendor_name: str
    rating: float
    submitted: bool  # only "Submitted / Not submitted" is shown before close (spec 9.6); drafts stay private
    submitted_at: datetime | None
    bid_id: int | None
    evaluations: list[EvaluationOut]
    evaluation_count: int
    result: ResultOut | None


class LineDetailOut(BaseModel):
    summary: LineSummaryOut
    criteria: list[CriterionOut]
    min_technical_score: float
    scored: bool
    can_evaluate: bool
    can_see_evaluations: bool  # evaluators only; the Officer sees the recorded results, not the scoring
    technical_closed_at: datetime | None
    vendors: list[VendorBidRow]


class EvaluationSave(BaseModel):
    decision: TechnicalDecision
    scores: dict[str, float | None] = {}
    comments: str | None = None

    @field_validator("comments")
    @classmethod
    def strip(cls, v):
        return (v or "").strip() or None


class CommercialRowOut(BaseModel):
    """One bid in the comparative statement. For a technically disqualified
    bid every price field is None: its price is never opened (spec 9.2.4)."""

    vendor_id: int
    vendor_name: str
    bid_id: int
    technical_outcome: TechnicalDecision
    technical_score: float | None
    t_rank: int | None
    technical_reason: str | None
    rating: float
    rank: int | None  # 1 = L1 (or C1 on QCBS lines)
    rank_label: str | None  # "L1", "L2", ... or "C1", "C2", ...
    recommended: bool
    unit_price: float | None
    gst_percent: float | None
    other_duties: float | None
    landed_unit_price: float | None
    total_price: float | None
    landed_total: float | None
    delivery_lead_days: int | None
    quote_validity_days: int | None
    payment_terms: str | None
    price_score: float | None  # QCBS only: lowest bid = 100
    combined_score: float | None  # QCBS only
    variance_pct: float | None  # unit price vs the internal estimated price
    price_flags: list[str]
    tie_note: str | None
    submitted_at: datetime | None


class CommercialStatementOut(BaseModel):
    summary: LineSummaryOut
    method: str  # "L1" or "QCBS"
    technical_weight: float | None
    price_weight: float | None
    estimated_price: float | None  # internal reference (spec 6.3: never shown to vendors)
    rows: list[CommercialRowOut]
