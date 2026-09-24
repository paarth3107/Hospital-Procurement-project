from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator

from app.models.product_master import ProcurementType
from app.schemas.product_attrs import ATTRS_BY_TYPE


class CategoryCreate(BaseModel):
    name: str
    procurement_type: ProcurementType
    min_mapping_rating: float | None = None

    @field_validator("name")
    @classmethod
    def name_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Category name is required")
        return v

    @field_validator("min_mapping_rating")
    @classmethod
    def rating_range(cls, v: float | None) -> float | None:
        if v is not None and not 0 <= v <= 100:
            raise ValueError("Minimum rating must be between 0 and 100")
        return v


class CategoryOut(BaseModel):
    id: int
    name: str
    procurement_type: ProcurementType
    min_mapping_rating: float | None
    active: bool

    model_config = {"from_attributes": True}


class ProductCreate(BaseModel):
    code: str
    name: str
    description: str | None = None
    procurement_type: ProcurementType
    category_id: int
    sub_category: str | None = None

    # Spec 4.2 core details -- all optional, chosen per entry.
    unit_of_measure: str | None = None
    regulatory_class: str | None = None
    approved_brands: list[str] = []
    reorder_level: float | None = None
    price_band_min: float | None = None
    price_band_max: float | None = None
    # Spec 4.4 point 2: rating a vendor needs in this type to be mapped.
    min_mapping_rating: float | None = None

    # Validated against the per-type attribute set (schemas/product_attrs.py).
    type_specific_attrs: dict = {}

    @model_validator(mode="after")
    def check_rules(self):
        attrs_model = ATTRS_BY_TYPE[self.procurement_type]
        # Drop unset keys so only what the creator filled in is stored.
        self.type_specific_attrs = attrs_model(**self.type_specific_attrs).model_dump(exclude_none=True)
        if self.min_mapping_rating is not None and not 0 <= self.min_mapping_rating <= 100:
            raise ValueError("Minimum rating must be between 0 and 100")
        if self.price_band_min is not None and self.price_band_max is not None and self.price_band_min > self.price_band_max:
            raise ValueError("Price band minimum cannot exceed its maximum")
        self.approved_brands = [b.strip() for b in self.approved_brands if b.strip()]
        return self


class ProductOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    procurement_type: ProcurementType
    category_id: int
    category: str
    sub_category: str | None
    unit_of_measure: str | None
    regulatory_class: str | None
    approved_brands: list[str]
    reorder_level: float | None
    price_band_min: float | None
    price_band_max: float | None
    min_mapping_rating: float | None
    type_specific_attrs: dict
    active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
