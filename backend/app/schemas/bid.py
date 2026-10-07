from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.bid import BidAttachmentKind, BidStatus
from app.models.product_master import ProcurementType
from app.models.tender import TenderType
from app.models.tender_line_item import TechnicalEvalMethod
from app.schemas.tender import LineAttachmentOut


# ---- Type-specific answers (spec 8.2, 6.3.x, 9.2.2). Unknown keys are refused,
# so a Service bid can't carry Asset fields and vice versa. ----
class _Details(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ItemDetails(_Details):
    shelf_life_months: float | None = None  # shelf life remaining at delivery (batch/expiry-tracked items)


class AssetDetails(_Details):
    warranty_months: float | None = None
    installation_included: bool | None = None
    training_included: bool | None = None
    spares_commitment_years: float | None = None
    bidding_as_distributor: bool | None = None  # then a manufacturer authorization letter is mandatory


class ServiceDetails(_Details):
    sow_response: str | None = None  # proposed SOW / method statement
    manpower_plan: str | None = None
    sla_commitment: str | None = None


DETAILS_BY_TYPE: dict[ProcurementType, type[_Details]] = {
    ProcurementType.ITEM: ItemDetails,
    ProcurementType.ASSET: AssetDetails,
    ProcurementType.SERVICE: ServiceDetails,
}


class BidSave(BaseModel):
    """Save a draft (submit=False) or submit / amend (submit=True). All fields
    are optional for a draft; the server's submit gate requires the rest."""

    unit_price: float | None = None
    gst_percent: float | None = None
    other_duties: float | None = None
    delivery_lead_days: int | None = None
    quote_validity_days: int | None = None
    payment_terms: str | None = None
    compliant_full: bool = False
    technical_compliance: str | None = None
    brand_offered: str | None = None
    details: dict = {}
    comments: str | None = None  # free-text, never required (2026-10-01, user-directed)
    submit: bool = False

    @field_validator("unit_price")
    @classmethod
    def price_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Unit price must be a positive number")
        return v

    @field_validator("gst_percent")
    @classmethod
    def gst_range(cls, v):
        if v is not None and not 0 <= v <= 100:
            raise ValueError("GST % must be between 0 and 100")
        return v

    @field_validator("other_duties", "delivery_lead_days")
    @classmethod
    def not_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("This value can't be negative")
        return v

    @field_validator("quote_validity_days")
    @classmethod
    def validity_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Quote validity must be at least 1 day")
        return v

    @field_validator("payment_terms", "technical_compliance", "brand_offered", "comments")
    @classmethod
    def blank_to_none(cls, v):
        if v is None:
            return None
        v = v.strip()
        return v or None


class BidLineSave(BidSave):
    """One row of a bulk grid save (2026-10-01: the vendor bid workspace is
    now a spreadsheet grid, same pattern as tender line-item creation) --
    BidSave plus which line it's for."""

    line_item_id: int


class BidBulkSave(BaseModel):
    lines: list[BidLineSave]


class AttachmentOut(BaseModel):
    id: int
    kind: BidAttachmentKind
    description: str | None
    original_filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class BidOut(BaseModel):
    id: int
    status: BidStatus
    unit_price: float | None
    gst_percent: float | None
    other_duties: float | None
    delivery_lead_days: int | None
    quote_validity_days: int | None
    payment_terms: str | None
    compliant_full: bool
    technical_compliance: str | None
    brand_offered: str | None
    details: dict
    comments: str | None
    submitted_at: datetime | None
    amended_at: datetime | None
    withdrawn_at: datetime | None
    attachments: list[AttachmentOut]
    # Derived, for the bidding vendor's own view only
    total_price: float | None  # unit price x quantity
    landed_unit_price: float | None  # unit price + GST + other duties (what evaluation ranks on, spec 9.3)
    landed_total: float | None


class SlotOut(BaseModel):
    kind: BidAttachmentKind
    label: str
    mandatory: bool


class RequirementsOut(BaseModel):
    required_fields: list[str]  # what the submit gate will demand (beyond attachments)
    compliance_required: bool
    slots: list[SlotOut]


class CatalogSpecOut(BaseModel):
    """What the vendor is being asked to meet (spec §4.2.1/§4.2.2) -- a
    deliberately narrow subset of ProductMaster (2026-10-01, user-directed):
    never reorder_level, price_band_min/max, min_mapping_rating or
    required_documents, all staff-only internal inventory/budget/eligibility
    facts, not part of what's being procured."""

    unit_of_measure: str | None
    regulatory_class: str | None
    approved_brands: list[str]
    type_specific_attrs: dict


class LineContextOut(BaseModel):
    line_item_id: int
    tender_id: int
    tender_title: str
    tender_type: TenderType
    product_name: str
    procurement_type: ProcurementType
    qty: float
    uom: str | None
    bid_due_date: datetime | None
    technical_eval_method: TechnicalEvalMethod
    technical_weight: float | None  # QCBS only -- spec: vendors are told upfront how they'll be evaluated
    price_weight: float | None
    split_award_allowed: bool
    shelf_life_tracked: bool
    catalog_spec: CatalogSpecOut
    line_details: dict  # this tender's own per-engagement overrides (delivery date/location, tenure, etc.)
    attachments: list[LineAttachmentOut]  # the officer's SOW/spec documents for this line (spec §6.4)


class BidFormOut(BaseModel):
    context: LineContextOut
    requirements: RequirementsOut
    bid: BidOut | None
    locked: bool  # true = the vendor can view but not change
    lock_reason: str | None


class TenderBidsOut(BaseModel):
    """Every line a vendor was invited to bid on within one tender, in a
    single call -- backs the bid grid (2026-10-01) instead of the previous
    one-GET-per-line pattern."""

    tender_id: int
    tender_title: str
    tender_type: TenderType
    tender_description: str | None
    facility_name: str
    terms_document_filename: str | None  # vendor downloads it via GET .../terms-document/download
    open_tender: bool
    is_rate_contract: bool
    contract_start_date: date | None
    contract_end_date: date | None
    rate_contract_document_filename: str | None  # vendor downloads it via GET .../rate-contract-document/download
    bid_due_date: datetime | None
    lines: list[BidFormOut]


class BidBulkSaveResult(BaseModel):
    line_item_id: int
    ok: bool
    error: str | None = None
    form: BidFormOut | None = None


class MyBidOut(BaseModel):
    id: int
    tender_line_item_id: int
    tender_id: int
    tender_title: str
    product_name: str
    qty: float
    status: BidStatus
    unit_price: float | None
    total_price: float | None
    submitted_at: datetime | None
    outcome: str | None = None  # awarded / not selected / technically disqualified, once known
