from datetime import date, datetime

from pydantic import BaseModel, field_validator, model_validator

from app.models.product_master import ProcurementType
from app.models.tender import TenderStatus, TenderType
from app.models.tender_approval_round import RoundDecision
from app.models.tender_line_item import TechnicalEvalMethod
from app.models.tender_attachment import TenderLineAttachmentKind
from app.schemas.line_details import LINE_DETAILS_BY_TYPE


class LineItemCreate(BaseModel):
    # Set only when this payload is updating an existing line (PUT on an
    # existing Draft tender) -- lets _set_line_items match against the
    # existing row instead of deleting and recreating it, which would
    # cascade-delete that line's attachments (2026-10-01: attachments are
    # user-uploaded content, unlike TenderInvite rows, which really are
    # meant to be recomputed fresh on every save).
    id: int | None = None
    product_master_id: int
    procurement_type: ProcurementType
    # Optional (2026-10-01, user-directed): a line only needs a resolved
    # catalog entry to be saved and get a real id (documents can then be
    # attached to it) -- qty, like Tender.facility_id/title, is required only
    # from submit-for-approval onward, not at every draft save.
    qty: float | None = None
    estimated_price: float | None = None
    split_award_allowed: bool = False
    min_rating_threshold_override: float | None = None
    technical_eval_method: TechnicalEvalMethod = TechnicalEvalMethod.QUALIFY_DISQUALIFY
    technical_weight: float | None = None
    price_weight: float | None = None
    line_details: dict = {}

    @field_validator("qty")
    @classmethod
    def qty_positive(cls, v: float | None) -> float | None:
        # None is allowed (draft, not yet filled in) -- only a genuinely
        # invalid non-null value is rejected here. Required-ness is enforced
        # at submit-for-approval instead (tenders.py), same split as
        # Tender.facility_id/title.
        if v is not None and v <= 0:
            raise ValueError("qty must be greater than zero")
        return v

    # Note: QCBS's Technical/Price Weight requirement (spec §9.4) is NOT
    # enforced here -- a draft line may have QCBS chosen with weights not
    # filled in yet. Enforced at submit-for-approval instead (tenders.py),
    # same split as qty above.

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
    given, replaces the tender's whole line-item list.

    facility_id is optional here (2026-10-01, user-directed): a Draft
    tolerates it being unset, same as everything else about a Draft --
    required only at submit-for-approval time (tenders.py), since that's
    the point everything downstream (approval matrix, PO facility code)
    actually needs a real one."""

    facility_id: int | None = None
    title: str
    description: str | None = None
    tender_type: TenderType
    department: str | None = None
    min_rating_threshold: float = 0.0
    min_invites: int | None = None
    max_invites: int | None = None
    open_tender: bool = False
    is_rate_contract: bool = False
    contract_start_date: date | None = None
    contract_end_date: date | None = None
    publish_date: datetime | None = None
    bid_due_date: datetime | None = None
    # Terms & Conditions is a mandatory uploaded document (2026-10-07), not a
    # field here -- it's set through its own endpoint (POST .../terms-document),
    # the same split as a line item's attachments.
    line_items: list[LineItemCreate] = []

    @model_validator(mode="after")
    def contract_dates_ordered(self):
        # Required-together is enforced at submit-for-approval (tenders.py), same
        # split as facility_id/title -- a Draft tolerates either being unset. This
        # only rejects a pair that's already self-contradictory.
        if self.contract_start_date and self.contract_end_date and self.contract_end_date <= self.contract_start_date:
            raise ValueError("Contract end date must be after the start date")
        return self


class TenderOut(BaseModel):
    id: int
    facility_id: int | None
    title: str
    description: str | None
    tender_type: TenderType
    status: TenderStatus
    department: str | None
    min_rating_threshold: float
    min_invites: int | None
    max_invites: int | None
    open_tender: bool
    open_link_token: str | None = None  # staff only: the Open Tender registration link
    is_rate_contract: bool
    contract_start_date: date | None
    contract_end_date: date | None
    rate_contract_document_filename: str | None
    rate_contract_document_size: int | None
    rate_contract_document_uploaded_at: datetime | None
    publish_date: datetime | None
    bid_due_date: datetime | None
    terms_document_filename: str | None
    terms_document_size: int | None
    terms_document_uploaded_at: datetime | None
    published_at: datetime | None
    round_number: int
    created_at: datetime

    model_config = {"from_attributes": True}


class LineAttachmentOut(BaseModel):
    id: int
    kind: TenderLineAttachmentKind
    custom_label: str | None
    original_filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class LineItemOut(BaseModel):
    id: int
    tender_id: int
    product_master_id: int
    procurement_type: ProcurementType
    qty: float | None
    estimated_price: float | None
    split_award_allowed: bool
    published: bool
    min_rating_threshold_override: float | None
    technical_eval_method: TechnicalEvalMethod
    technical_weight: float | None
    price_weight: float | None
    line_details: dict
    attachments: list[LineAttachmentOut] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class EligibleVendorOut(BaseModel):
    vendor_id: int
    legal_name: str
    rating_score: float
    source: str = "system"  # system | open | guest
    reason: str | None = None  # guest invites only


def _clean_reason(v: str, what: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError(f"A reason is required to {what}")
    if len(v) > 500:
        raise ValueError("Keep the reason to 500 characters")
    return v


class GuestInviteCreate(BaseModel):
    vendor_id: int
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        return _clean_reason(v, "invite a vendor outside the eligibility rules")


class VendorRemovalCreate(BaseModel):
    vendor_ids: list[int]
    reason: str

    @field_validator("vendor_ids")
    @classmethod
    def at_least_one(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("Choose at least one vendor to remove")
        return sorted(set(v))

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        return _clean_reason(v, "remove a vendor from this line")


class ExcludedVendorOut(BaseModel):
    vendor_id: int
    legal_name: str
    reason: str


class LineItemEligibilityOut(BaseModel):
    line_item_id: int
    product_name: str
    product_master_id: int
    threshold_applied: float
    eligible_vendors: list[EligibleVendorOut]
    removed_vendors: list[ExcludedVendorOut] = []


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
    reason: str | None = None
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
