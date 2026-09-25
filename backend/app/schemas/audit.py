from datetime import datetime

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: int
    occurred_at: datetime
    actor_type: str
    actor_id: int | None
    actor_name: str | None
    actor_role: str | None
    action: str
    entity_type: str
    entity_id: int | None
    entity_label: str | None
    facility_id: int | None
    before_state: dict | None
    after_state: dict | None
    reason: str | None
    meta: dict | None
    imported: bool

    model_config = {"from_attributes": True}


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int


class AuditFilterOptions(BaseModel):
    entity_types: list[str]
    actions: list[str]
