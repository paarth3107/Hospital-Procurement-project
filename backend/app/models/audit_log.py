from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Column, ForeignKey, Index, Integer, String, Text

from app.database import Base, UTCDateTime


class AuditLog(Base):
    """Spec §14 / §12.6: the immutable audit trail. Insert-only -- a database
    trigger rejects UPDATE and DELETE (and, on Postgres only, TRUNCATE -- see
    app/init_db.py's docstring for why MySQL can't enforce that one the same
    way) so no application code path can alter history. Created by the
    a1d0c7e94b21 migration on Postgres, or by app/init_db.py on a fresh
    MySQL database (2026-10-08 port; see backend/README.md). The actor's name
    and role are copied in at write time, so the record stays true even if
    the account is later renamed, re-roled or deactivated."""

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    # Real bug, found 2026-10-16, user-reported (timestamps showing ~5.5h in
    # the future): server_default=func.now() let MySQL itself compute this
    # value using the DB SERVER's configured time_zone ("SYSTEM" on both the
    # remote host and local dev -- both resolve to IST, not UTC), bypassing
    # UTCDateTime's own bind-param processing entirely (a server-side SQL
    # default is never a bound Python value, so the type's "always UTC"
    # contract silently didn't apply here). A Python-side `default` IS a
    # bound value, so it round-trips through UTCDateTime correctly and is
    # portable regardless of what timezone any given DB server happens to
    # be set to. Same fix applied across every other `server_default=
    # func.now()`/`onupdate=func.now()` column in this app -- see git log
    # for the full list (audit_log, award, bid, bid_evaluation, override,
    # product_master, tender, tender_approval_round, tender_attachment,
    # tender_invite, tender_line_exclusion, tender_line_item, user_account,
    # vendor, vendor_mapping, vendor_rating). Existing rows written before
    # this fix keep their (wrong) stored value -- audit_log is immutable by
    # design (the trigger below), so this only corrects things going forward.
    occurred_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)

    actor_type = Column(String(255), nullable=False)  # staff | vendor | system
    actor_id = Column(Integer, nullable=True)  # user_accounts.id or vendors.id (null for system)
    actor_name = Column(String(255), nullable=True)
    actor_role = Column(String(255), nullable=True)  # staff role value, "vendor", or null for system

    action = Column(String(255), nullable=False, index=True)  # e.g. vendor.status_changed
    entity_type = Column(String(255), nullable=False)  # vendor, mapping, tender, staff, ...
    entity_id = Column(Integer, nullable=True)
    entity_label = Column(String(255), nullable=True)  # human-readable name at the time
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)  # spec §2.3 filtering

    before_state = Column(JSON, nullable=True)
    after_state = Column(JSON, nullable=True)
    reason = Column(Text, nullable=True)
    meta = Column(JSON, nullable=True)  # extra context: approval round, required tier, escalation path...

    imported = Column(Boolean, nullable=False, default=False)  # True = copied from a pre-audit-log history table

    __table_args__ = (
        Index("ix_audit_log_occurred_at", "occurred_at"),
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
        Index("ix_audit_log_actor", "actor_type", "actor_id"),
    )
