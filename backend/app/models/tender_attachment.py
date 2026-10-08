import enum

from sqlalchemy import Column, Enum, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.orm import relationship

from app.database import Base, UTCDateTime


class TenderLineAttachmentKind(str, enum.Enum):
    """Spec §6.4 line-item-level attachments. SOW_DOCUMENT is mandatory for
    Service lines (spec §6.3.5, §6.4.1) -- checked per line item, not against
    the catalog entry, since two Service lines in the same tender can need
    two entirely different SOWs (2026-10-01, user-directed). TECHNICAL_SPEC_SHEET
    is spec'd as mandatory for Asset lines above a configured value -- not
    enforced yet, no such threshold config exists; the kind exists so
    uploading one doesn't need a schema change once it is."""

    SOW_DOCUMENT = "sow_document"
    TECHNICAL_SPEC_SHEET = "technical_spec_sheet"
    ENGINEERING_DRAWING = "engineering_drawing"
    REFERENCE_IMAGE = "reference_image"
    OTHER = "other"


class TenderLineAttachment(Base):
    """One file attached to one tender line item at creation time (Procurement
    Officer/Category Manager), spec §6.4 -- distinct from a vendor's own bid
    attachments (app/models/bid.py's BidAttachment)."""

    __tablename__ = "tender_line_attachments"

    id = Column(Integer, primary_key=True)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False, index=True)
    kind = Column(Enum(TenderLineAttachmentKind), nullable=False)
    custom_label = Column(String(255), nullable=True)  # only for OTHER

    original_filename = Column(String(255), nullable=False)
    content_type = Column(String(255), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    # length hint (2026-10-08) -- MySQL maps a bare LargeBinary to BLOB (64KB
    # cap); the hint picks MEDIUMBLOB (16MB) instead, matching document_store's
    # own 10MB upload limit. No effect on Postgres/sqlite.
    content = Column(LargeBinary(length=16_777_215), nullable=False)
    uploaded_at = Column(UTCDateTime(), server_default=func.now())
    uploaded_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)

    line_item = relationship("TenderLineItem", back_populates="attachments")
