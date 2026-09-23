import enum

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String, Text, func
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
    rejection_reason = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decided_by_id = Column(Integer, nullable=True)  # FK to user_accounts.id once approval history needs it

    documents = relationship("VendorDocument", back_populates="vendor", cascade="all, delete-orphan")


class VendorDocument(Base):
    """Spec §3.2 document uploads. File content itself is out of scope for
    this pass — `file_ref` is a placeholder path/URL, not a real upload
    pipeline (that's the DocumentStore adapter, IMPLEMENTATION-SPEC.md §9)."""

    __tablename__ = "vendor_documents"

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    doc_type = Column(String, nullable=False)
    file_ref = Column(String, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    vendor = relationship("Vendor", back_populates="documents")
