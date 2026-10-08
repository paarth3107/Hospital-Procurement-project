from sqlalchemy import Column, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base, UTCDateTime


class TenderInvite(Base):
    """Spec §6.5 — the resolved per-line-item invite list. `source` is "system"
    (the eligibility rules), "open" (Open Tender: every Active vendor) or
    "guest" (an officer's invite outside the rules, with a `reason`). Every row
    is an Active vendor (CLAUDE.md PROJECT OVERRIDE). Recalculation rewrites
    system and open rows and keeps guest rows while their vendor stays Active."""

    __tablename__ = "tender_invites"
    __table_args__ = (UniqueConstraint("tender_line_item_id", "vendor_id", name="uq_invite_line_vendor"),)

    id = Column(Integer, primary_key=True)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    source = Column(String(255), nullable=False, default="system")
    rating_at_resolution = Column(Float, nullable=False)
    # Required for source == "guest": why an officer invited a vendor the rules didn't select.
    reason = Column(Text, nullable=True)
    created_at = Column(UTCDateTime(), server_default=func.now())

    line_item = relationship("TenderLineItem", back_populates="invites")
    vendor = relationship("Vendor")
