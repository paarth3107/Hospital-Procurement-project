from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB

from app.database import Base


class AuditLog(Base):
    """Spec §14 / §12.6: the immutable audit trail. Insert-only -- a database
    trigger (see the migration) rejects UPDATE, DELETE and TRUNCATE, so no
    application code path can alter history. The actor's name and role are
    copied in at write time, so the record stays true even if the account is
    later renamed, re-roled or deactivated."""

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    actor_type = Column(String, nullable=False)  # staff | vendor | system
    actor_id = Column(Integer, nullable=True)  # user_accounts.id or vendors.id (null for system)
    actor_name = Column(String, nullable=True)
    actor_role = Column(String, nullable=True)  # staff role value, "vendor", or null for system

    action = Column(String, nullable=False, index=True)  # e.g. vendor.status_changed
    entity_type = Column(String, nullable=False)  # vendor, mapping, tender, staff, ...
    entity_id = Column(Integer, nullable=True)
    entity_label = Column(String, nullable=True)  # human-readable name at the time
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)  # spec §2.3 filtering

    before_state = Column(JSONB, nullable=True)
    after_state = Column(JSONB, nullable=True)
    reason = Column(Text, nullable=True)
    meta = Column(JSONB, nullable=True)  # extra context: approval round, required tier, escalation path...

    imported = Column(Boolean, nullable=False, default=False)  # True = copied from a pre-audit-log history table

    __table_args__ = (
        Index("ix_audit_log_occurred_at", "occurred_at"),
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
        Index("ix_audit_log_actor", "actor_type", "actor_id"),
    )
