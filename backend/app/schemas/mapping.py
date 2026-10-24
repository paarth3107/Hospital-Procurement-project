from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.vendor_mapping import MappingState
from app.schemas.validators import require_reason


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
    # The reason text behind this mapping's current state (the most recent
    # history row's reason), so Mapping Requests can show a one-line preview
    # without the list page fetching full history per row. Real bug, found
    # 2026-10-24: a Suspend/Reject reason here used to vanish from view the
    # moment the row updated -- nothing on this screen (only the Mapping
    # Matrix detail dialog's own history pane) ever surfaced it again.
    latest_reason: str | None = None

    model_config = {"from_attributes": True}


class MappingDecisionReason(BaseModel):
    """Spec §4.3 point 3 — rejection and suspension are always logged with a
    reason; approval isn't (there's nothing to explain away)."""

    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        return require_reason(v)


class MappingHistoryOut(BaseModel):
    id: int
    from_state: MappingState | None
    to_state: MappingState
    reason: str | None
    actor_id: int | None
    # Resolved from UserAccount.full_name in the router, not a model column
    # (real bug, found 2026-10-24: this history showed WHO decided a mapping
    # nowhere, only actor_id -- added for parity with every other reason
    # field now expected to track who entered it, per spec §4.3 point 3).
    actor_name: str | None = None
    at: datetime

    model_config = {"from_attributes": True}
