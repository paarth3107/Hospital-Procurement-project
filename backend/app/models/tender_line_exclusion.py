from sqlalchemy import Column, ForeignKey, Integer, Text, UniqueConstraint, func

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
    created_at = Column(UTCDateTime(), server_default=func.now())
