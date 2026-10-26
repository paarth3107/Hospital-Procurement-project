from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.override import OverrideStatus, OverrideType
from app.models.user_account import Role
from app.schemas.validators import require_reason


class OverrideCreate(BaseModel):
    override_type: OverrideType
    entity_type: str
    entity_id: int | None = None
    entity_label: str | None = None
    facility_id: int | None = None
    justification: str
    proposed_change: dict | None = None
    trigger_value: float | None = None


class OverrideDecision(BaseModel):
    reason: str | None = None


class OverrideRejection(BaseModel):
    """Reject-only variant of OverrideDecision (real bug, found 2026-10-24):
    the shared schema's reason was optional since Approve legitimately needs
    none, which meant Reject never actually required one either -- every
    "reject a governed override" endpoint accepted an empty reason. Used only
    by the 6 reject_* endpoints; approve/escalate keep OverrideDecision."""

    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        return require_reason(v)


class OverrideOut(BaseModel):
    id: int
    override_type: OverrideType
    entity_type: str
    entity_id: int | None
    entity_label: str | None
    facility_id: int | None
    initiator_id: int
    initiator_role: Role
    justification: str
    proposed_change: dict | None
    status: OverrideStatus
    escalation_level: int
    required_approver_role: Role | None
    required_approver_min_tier: int | None
    sla_due_at: datetime | None
    decided_by_id: int | None
    decided_at: datetime | None
    decision_reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
