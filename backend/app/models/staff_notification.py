from datetime import datetime, timezone

from sqlalchemy import Column, ForeignKey, Integer, String, Text

from app.database import Base, UTCDateTime


class StaffNotification(Base):
    """A short, informational message to a staff user -- same shape as
    award.py's vendor-facing Notification, but there's no staff equivalent
    of that model to reuse (vendor_id there is non-nullable). First use
    (2026-10-22, user-directed): telling an override's initiator once a
    Category Manager/Approving Authority/etc. approves or rejects it --
    services/overrides.py's approve_override()/reject_override() write
    these, not any per-router code, so every override type gets this for
    free. Deliberately terse (kind/title/body, no `data` JSON blob like the
    vendor model has) -- "small, precise, just informatory", not a feed.

    `entity_type`/`entity_id` added 2026-10-29 (user-directed: tell the
    Procurement Officer who submitted a tender round when it's approved or
    rejected) -- the click-through needs to land on that specific tender,
    not just "somewhere". Generic (not `tender_id`) and nullable, same
    (entity_type, entity_id) shape services/audit.py's AuditLog already
    uses, rather than a one-off column -- a future notification kind that
    points at some other record reuses this instead of adding its own."""

    __tablename__ = "staff_notifications"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False, index=True)
    kind = Column(String(255), nullable=False)  # override_approved | override_rejected | tender_approved | tender_rejected
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    entity_type = Column(String(50), nullable=True)
    entity_id = Column(Integer, nullable=True)
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))
    read_at = Column(UTCDateTime(), nullable=True)
