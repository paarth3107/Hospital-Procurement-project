from datetime import datetime, timezone

from sqlalchemy import Column, ForeignKey, Integer, Text, UniqueConstraint

from app.database import Base, UTCDateTime


class TenderLineExclusion(Base):
    """A vendor the officer removed from one line item (2026-10-06). It holds
    through every recalculation, so the rules don't put the vendor back. The
    reason is required and kept on record."""

    __tablename__ = "tender_line_exclusions"
    __table_args__ = (UniqueConstraint("tender_line_item_id", "vendor_id", name="uq_exclusion_line_vendor"),)

    id = Column(Integer, primary_key=True)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    reason = Column(Text, nullable=False)
    # Real bug, found 2026-10-16 -- see audit_log.py's AuditLog.occurred_at
    # for the full explanation (server_default=func.now() used the DB
    # server's own local timezone instead of true UTC).
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))
