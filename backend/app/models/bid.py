import enum

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base


class BidStatus(str, enum.Enum):
    """First-pass Bidding scope (spec §8): a vendor submits once per line
    item they're invited to. Amendment/withdrawal, technical submissions,
    attachments, and price-confidentiality masking for staff-side viewing
    are deliberately not built yet -- see backend/README.md."""

    SUBMITTED = "submitted"


class Bid(Base):
    __tablename__ = "bids"
    __table_args__ = (UniqueConstraint("tender_line_item_id", "vendor_id", name="uq_bid_line_item_vendor"),)

    id = Column(Integer, primary_key=True)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)

    # Reference §9.6 "price confidentiality": this column is never
    # serialized to anyone but the bidding vendor themselves in this pass --
    # there is no staff-facing bid-read endpoint yet (that's Evaluation,
    # Phase 5), so there's nothing else that could leak it prematurely.
    unit_price = Column(Float, nullable=False)

    status = Column(Enum(BidStatus), nullable=False, default=BidStatus.SUBMITTED)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())

    line_item = relationship("TenderLineItem")
    vendor = relationship("Vendor")
