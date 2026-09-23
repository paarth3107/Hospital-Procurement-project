import enum

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base


class VendorStatus(str, enum.Enum):
    """Spec §3.4. `ACTIVE` is the single, non-negotiable gate for any
    bid-related action anywhere in this system (CLAUDE.md PROJECT OVERRIDE) —
    there is no status here that permits bidding before Active."""

    DRAFT = "draft"
    PENDING_VERIFICATION = "pending_verification"
    INFO_REQUESTED = "info_requested"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REJECTED = "rejected"


class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(Integer, primary_key=True)
    status = Column(Enum(VendorStatus), nullable=False, default=VendorStatus.PENDING_VERIFICATION)

    legal_name = Column(String, nullable=False)
    gstin = Column(String, nullable=False, unique=True, index=True)
    pan = Column(String, nullable=True)

    contact_person = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)

    # Set at registration (schemas/vendor.py's VendorCreate.password) so a
    # vendor can log in immediately and check status -- there's no email/SMS
    # adapter built yet to deliver a temp password later, so "set your own at
    # registration" is the only path that doesn't need one. Nullable only
    # for rows that predate this column; every new registration sets it.
    hashed_password = Column(String, nullable=True)

    category_declaration = Column(String, nullable=True)  # comma-separated for this first pass

    # Reused for both terminal Rejected and Info Requested -- either way
    # it's "the explanation for the vendor's current non-Active status",
    # not specifically a rejection; the column name predates Info Requested
    # gaining its own reason.
    rejection_reason = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decided_by_id = Column(Integer, nullable=True)  # FK to user_accounts.id once approval history needs it

    documents = relationship("VendorDocument", back_populates="vendor", cascade="all, delete-orphan")


class VendorDocType(str, enum.Enum):
    """Spec §3.2's KYC checklist, fixed rather than freeform (same reasoning
    as Category Declaration's move to checkboxes — a known set beats
    free text nobody downstream can rely on matching)."""

    GST_CERTIFICATE = "gst_certificate"
    PAN_CARD = "pan_card"
    INCORPORATION_CERTIFICATE = "incorporation_certificate"
    BANK_PROOF = "bank_proof"


MANDATORY_DOC_TYPES = {VendorDocType.GST_CERTIFICATE, VendorDocType.PAN_CARD, VendorDocType.INCORPORATION_CERTIFICATE}


class DocumentStatus(str, enum.Enum):
    """Independent of VendorStatus -- a vendor can be Pending Verification
    while individual documents are Verified/Rejected one at a time. Vendor
    approval itself is gated on every mandatory doc being Verified (see
    routers/vendors.py once that gate is built)."""

    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class VendorDocument(Base):
    """Spec §3.2 document uploads. Stored directly in Postgres (BYTEA) via
    `content` rather than a filesystem/object-store path -- CLAUDE.md calls
    Document/DMS storage an adapter boundary, and app/services/document_store.py
    is that adapter; swapping the backing store later only touches that file.
    One row per (vendor, doc_type) -- re-uploading replaces the previous file
    and resets it to Pending, since a changed file needs a fresh review."""

    __tablename__ = "vendor_documents"
    __table_args__ = (UniqueConstraint("vendor_id", "doc_type", name="uq_vendor_doctype"),)

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    doc_type = Column(Enum(VendorDocType), nullable=False)

    original_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    content = Column(LargeBinary, nullable=False)

    status = Column(Enum(DocumentStatus), nullable=False, default=DocumentStatus.PENDING)
    rejection_reason = Column(Text, nullable=True)
    reviewed_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    vendor = relationship("Vendor", back_populates="documents")
