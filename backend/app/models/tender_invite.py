from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base, UTCDateTime


class TenderInvite(Base):
    """Spec §6.5 — the resolved per-line-item invite list. `source` is "system"
    (the eligibility rules), "open" (Open Tender: every Active vendor) or
    "manual" (an officer's §6.6 manual add outside the rules, with a
    `reason` -- renamed 2026-10-21 from "guest"/"guest invite", which was a
    mislabel for a different, unimplemented spec §6.7 feature; see
    CLAUDE.md). Every row is an Active vendor (CLAUDE.md PROJECT OVERRIDE).
    Recalculation rewrites system and open rows and keeps manual rows while
    their vendor stays Active."""

    __tablename__ = "tender_invites"
    __table_args__ = (UniqueConstraint("tender_line_item_id", "vendor_id", name="uq_invite_line_vendor"),)

    id = Column(Integer, primary_key=True)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    source = Column(String(255), nullable=False, default="system")
    rating_at_resolution = Column(Float, nullable=False)
    # Snapshot of EligibleVendor.is_unrated at the moment this invite was
    # resolved (2026-10-23) -- without it, a vendor who had zero rating
    # history when invited (only reachable when the line's threshold is 0)
    # would show a bare "0" on the E-Tender/L1 Approval review screen,
    # indistinguishable from a real, poor score.
    is_unrated_at_resolution = Column(Boolean, nullable=False, default=False)
    # Required for source == "manual": why an officer invited a vendor the rules didn't select.
    reason = Column(Text, nullable=True)
    # Real bug, found 2026-10-16 -- see audit_log.py's AuditLog.occurred_at
    # for the full explanation (server_default=func.now() used the DB
    # server's own local timezone instead of true UTC).
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))

    line_item = relationship("TenderLineItem", back_populates="invites")
    vendor = relationship("Vendor")
