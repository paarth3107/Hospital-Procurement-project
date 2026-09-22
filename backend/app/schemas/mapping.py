from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.vendor_mapping import MappingState


class MappingCreate(BaseModel):
    vendor_id: int
    product_master_id: int


class MappingOut(BaseModel):
    id: int
    vendor_id: int
    product_master_id: int
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
