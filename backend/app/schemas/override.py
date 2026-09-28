from datetime import datetime

from pydantic import BaseModel

from app.models.override import OverrideStatus, OverrideType
from app.models.user_account import Role


class OverrideCreate(BaseModel):
    override_type: OverrideType
    entity_type: str
    entity_id: int | None = None
    entity_label: str | None = None
    facility_id: int | None = None
    reason_code: str
    justification: str
    proposed_change: dict | None = None
    trigger_value: float | None = None


class OverrideDecision(BaseModel):
    reason: str | None = None


class OverrideOut(BaseModel):
    id: int
    override_type: OverrideType
    entity_type: str
    entity_id: int | None
    entity_label: str | None
    facility_id: int | None
    initiator_id: int
    initiator_role: Role
    reason_code: str
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
