from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.vendor_mapping import MappingState


class MappingCreate(BaseModel):
    """Staff-side request (Vendor Mapping matrix): exactly one of
    product_master_id (item mapping) / category_id (category mapping)."""

    vendor_id: int
    product_master_id: int | None = None
    category_id: int | None = None


class VendorMappingRequest(BaseModel):
    """Vendor-side request -- vendor_id comes from the login, never the body."""

    product_master_id: int | None = None
    category_id: int | None = None


class MappingOut(BaseModel):
    id: int
    vendor_id: int
    product_master_id: int | None
    category_id: int | None
    state: MappingState
    requested_at: datetime
    decided_by_id: int | None
    decided_at: datetime | None
    version: int

    model_config = {"from_attributes": True}


class MappingDecisionReason(BaseModel):
    """Spec §4.3 point 3 — rejection and suspension are always logged with a
    reason; approval isn't (there's nothing to explain away)."""

    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A reason is required")
        return v.strip()


class MappingHistoryOut(BaseModel):
    id: int
    from_state: MappingState | None
    to_state: MappingState
    reason: str | None
    actor_id: int | None
    at: datetime

    model_config = {"from_attributes": True}
