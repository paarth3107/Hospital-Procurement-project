from datetime import datetime

from pydantic import BaseModel


class StaffNotificationOut(BaseModel):
    """Mirrors vendor_notifications.py's NotificationOut shape (`read` as a
    bool, not the raw `read_at` timestamp)."""

    id: int
    kind: str
    title: str
    body: str
    entity_type: str | None = None
    entity_id: int | None = None
    created_at: datetime
    read: bool
