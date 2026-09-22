from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base


class TenderInvite(Base):
    """Spec §6.5 — the resolved per-line-item eligible-vendor list. Every row
    here is, by construction, an Active approved vendor (CLAUDE.md PROJECT
    OVERRIDE) — the resolver in app/services/eligibility.py never considers
    a non-Active vendor. `source` is a plain string rather than an enum
    because this phase only ever writes "system"; manual-add/guest-invite/
    open-tender sourcing (spec §6.6-6.8) are deferred to when the override
    engine (Phase 7) exists to gate them, per CLAUDE.md's "one reusable
    override engine, not bespoke logic per module.\""""

    __tablename__ = "tender_invites"
    __table_args__ = (UniqueConstraint("tender_line_item_id", "vendor_id", name="uq_invite_line_vendor"),)

    id = Column(Integer, primary_key=True)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    source = Column(String, nullable=False, default="system")
    rating_at_resolution = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    line_item = relationship("TenderLineItem", back_populates="invites")
    vendor = relationship("Vendor")
