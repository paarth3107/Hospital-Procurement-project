from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator

from app.models.product_master import ProcurementType
from app.models.tender import TenderStatus, TenderType
from app.models.tender_approval_round import RoundDecision
from app.models.tender_line_item import TechnicalEvalMethod
from app.schemas.line_details import LINE_DETAILS_BY_TYPE


class LineItemCreate(BaseModel):
    product_master_id: int
    procurement_type: ProcurementType
    qty: float
    estimated_price: float | None = None
    split_award_allowed: bool = False
    min_rating_threshold_override: float | None = None
    technical_eval_method: TechnicalEvalMethod = TechnicalEvalMethod.QUALIFY_DISQUALIFY
    technical_weight: float | None = None
    price_weight: float | None = None
    line_details: dict = {}

    @field_validator("qty")
    @classmethod
    def qty_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("qty must be greater than zero")
        return v

    @model_validator(mode="after")
    def qcbs_needs_weights(self):
        # Spec §9.4: QCBS's Technical/Price Weight is "configurable per line item" --
        # caught here, at save time, rather than only at commercial-evaluation time
        # (app/services/commercial_evaluation.py's own check) after bids have closed.
        if self.technical_eval_method == TechnicalEvalMethod.QCBS:
            if not self.technical_weight or not self.price_weight or self.technical_weight <= 0 or self.price_weight <= 0:
                raise ValueError("A QCBS line needs a positive technical weight and price weight")
        return self

    @model_validator(mode="after")
    def clean_line_details(self):
        # Spec §6.3.1-6.3.3 -- validated against the per-type field set
        # (schemas/line_details.py), same pattern as ProductCreate's
        # type_specific_attrs. mode="json" so a delivery_date validates to
        # an ISO string, not a raw date object the JSON column can't store.
        details_model = LINE_DETAILS_BY_TYPE[self.procurement_type]
        self.line_details = details_model(**self.line_details).model_dump(mode="json", exclude_none=True)
        return self


class TenderCreate(BaseModel):
    """Also the body of PUT (full replace of a Draft): line_items, when
    given, replaces the tender's whole line-item list."""


    facility_id: int
    title: str
    description: str | None = None
    tender_type: TenderType
    department: str | None = None
    min_rating_threshold: float = 0.0
    min_invites: int | None = None
    max_invites: int | None = None
    publish_date: datetime | None = None
    bid_due_date: datetime | None = None
    terms_and_conditions: str | None = None
    line_items: list[LineItemCreate] = []


class TenderOut(BaseModel):
    id: int
    facility_id: int
    title: str
    description: str | None
    tender_type: TenderType
    status: TenderStatus
    department: str | None
    min_rating_threshold: float
    min_invites: int | None
    max_invites: int | None
    publish_date: datetime | None
    bid_due_date: datetime | None
    terms_and_conditions: str | None
    published_at: datetime | None
    round_number: int
    created_at: datetime

    model_config = {"from_attributes": True}


class LineItemOut(BaseModel):
    id: int
    tender_id: int
    product_master_id: int
    procurement_type: ProcurementType
    qty: float
    estimated_price: float | None
    split_award_allowed: bool
    published: bool
    min_rating_threshold_override: float | None
    technical_eval_method: TechnicalEvalMethod
    technical_weight: float | None
    price_weight: float | None
    line_details: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class EligibleVendorOut(BaseModel):
    vendor_id: int
    legal_name: str
    rating_score: float


class LineItemEligibilityOut(BaseModel):
    line_item_id: int
    product_name: str
    product_master_id: int
    threshold_applied: float
    eligible_vendors: list[EligibleVendorOut]


class ApprovalRoundOut(BaseModel):
    id: int
    round_number: int
    decision: RoundDecision
    required_tier: int
    submitted_by_id: int | None
    submitted_at: datetime
    reviewer_id: int | None
    comments: str | None
    decided_at: datetime | None

    model_config = {"from_attributes": True}


class TenderInviteOut(BaseModel):
    id: int
    tender_line_item_id: int
    vendor_id: int
    source: str
    rating_at_resolution: float
    created_at: datetime

    model_config = {"from_attributes": True}


class ApprovalPayload(BaseModel):
    """Optional comments on an approval (spec 7.2 point 5: "approver identity,
    timestamp, and any comments")."""

    comments: str | None = None

    @field_validator("comments")
    @classmethod
    def blank_to_none(cls, v):
        return (v or "").strip() or None


class RejectionPayload(BaseModel):
    comments: str

    @field_validator("comments")
    @classmethod
    def comments_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Comments are required to reject a tender")
        return v.strip()
