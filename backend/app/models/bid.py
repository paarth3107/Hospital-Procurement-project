import enum

from sqlalchemy import JSON, Column, DateTime, Enum, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base


class BidStatus(str, enum.Enum):
    """Spec §8.4: a vendor can save a bid as a draft and submit before the due
    date. A submitted bid can be amended or withdrawn until the deadline; a
    withdrawn bid can be reopened as a draft."""

    DRAFT = "draft"
    SUBMITTED = "submitted"
    WITHDRAWN = "withdrawn"


class BidAttachmentKind(str, enum.Enum):
    """Spec §8.3: what a vendor attaches to a line's bid."""

    DATASHEET = "datasheet"  # technical compliance / datasheet document
    MANUFACTURER_AUTHORIZATION = "manufacturer_authorization"
    SOW_METHOD = "sow_method"  # proposed SOW / method statement (Service)
    MANPOWER_PLAN = "manpower_plan"
    WARRANTY_DOCUMENT = "warranty_document"
    CERTIFICATION = "certification"  # brand / model certification
    INSURANCE_PROOF = "insurance_proof"
    PHOTO = "photo"
    OTHER = "other"


class Bid(Base):
    """One vendor's quotation for one tender line item (spec §8.2)."""

    __tablename__ = "bids"
    __table_args__ = (UniqueConstraint("tender_line_item_id", "vendor_id", name="uq_bid_line_item_vendor"),)

    id = Column(Integer, primary_key=True)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)

    status = Column(Enum(BidStatus), nullable=False, default=BidStatus.DRAFT)

    # Commercial (spec §8.2). Nullable because a draft can be incomplete; the
    # submit gate (app/services/bids.py) requires them. Prices are sealed
    # (spec §9.6): only the bidding vendor can read them, and nothing
    # staff-facing exposes them before the deadline.
    unit_price = Column(Float, nullable=True)
    gst_percent = Column(Float, nullable=True)
    other_duties = Column(Float, nullable=True)  # per-unit amount on top of GST (freight-like duties/levies)
    delivery_lead_days = Column(Integer, nullable=True)
    quote_validity_days = Column(Integer, nullable=True)
    payment_terms = Column(Text, nullable=True)

    # Technical
    technical_compliance = Column(Text, nullable=True)  # compliance statement
    brand_offered = Column(String, nullable=True)
    # Type-specific answers (shelf life for Items, warranty/installation/
    # training/spares for Assets, method statement/manpower/SLA for Services);
    # validated per procurement type in app/schemas/bid.py.
    details = Column(JSON, nullable=False, default=dict)

    submitted_at = Column(DateTime(timezone=True), nullable=True)  # first submission (tie-break, spec §9.3)
    amended_at = Column(DateTime(timezone=True), nullable=True)
    withdrawn_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    line_item = relationship("TenderLineItem")
    vendor = relationship("Vendor")
    attachments = relationship("BidAttachment", back_populates="bid", cascade="all, delete-orphan", order_by="BidAttachment.id")


class BidAttachment(Base):
    __tablename__ = "bid_attachments"

    id = Column(Integer, primary_key=True)
    bid_id = Column(Integer, ForeignKey("bids.id"), nullable=False, index=True)
    kind = Column(Enum(BidAttachmentKind), nullable=False)
    description = Column(String, nullable=True)

    original_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    content = Column(LargeBinary, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    bid = relationship("Bid", back_populates="attachments")
