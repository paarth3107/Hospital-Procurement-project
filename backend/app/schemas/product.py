from datetime import datetime

from pydantic import BaseModel

from app.models.product_master import ProcurementType


class ProductCreate(BaseModel):
    code: str
    name: str
    description: str | None = None
    procurement_type: ProcurementType
    category: str
    sub_category: str | None = None
    # Spec §4.2.1/§4.2.2 — shape depends on procurement_type (unit of measure/
    # shelf-life for Item, warranty/certifications for Asset, SOW/SLA for
    # Service). Left as a free-form bag rather than per-type validation for
    # this pass — the spec itself calls the attribute list illustrative.
    type_specific_attrs: dict = {}


class ProductOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    procurement_type: ProcurementType
    category: str
    sub_category: str | None
    type_specific_attrs: dict
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
