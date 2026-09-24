import enum

from datetime import date, timedelta

from sqlalchemy import Column, Date, DateTime, Enum, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func
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
    BLACKLISTED = "blacklisted"  # spec 3.4 "Rejected / Blacklisted": an approved vendor permanently barred


class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(Integer, primary_key=True)
    status = Column(Enum(VendorStatus), nullable=False, default=VendorStatus.PENDING_VERIFICATION)

    legal_name = Column(String, nullable=False)
    gstin = Column(String, nullable=False, unique=True, index=True)
    pan = Column(String, nullable=True, unique=True)

    # Spec 3.2 Company Details. Columns are nullable only because vendors
    # registered before these fields existed have no values; registration
    # itself requires them.
    trade_name = Column(String, nullable=True)
    entity_type = Column(String, nullable=True)
    year_of_incorporation = Column(Integer, nullable=True)
    registered_address = Column(Text, nullable=True)
    branch_locations = Column(Text, nullable=True)

    # Spec 3.2 Banking Details (the cancelled cheque / bank letter is a document).
    bank_name = Column(String, nullable=True)
    bank_account_number = Column(String, nullable=True)
    bank_ifsc = Column(String, nullable=True)

    # Spec 3.2 Contact Details beyond the primary contact.
    contact_designation = Column(String, nullable=True)
    escalation_contact_name = Column(String, nullable=True)
    escalation_contact_phone = Column(String, nullable=True)
    escalation_contact_email = Column(String, nullable=True)

    # Spec 3.2 Commercial Terms (optional).
    payment_terms = Column(String, nullable=True)
    delivery_lead_time_days = Column(Integer, nullable=True)
    min_order_value = Column(Float, nullable=True)

    contact_person = Column(String, nullable=False)
    # Unique like GSTIN: email is the vendor's login, and phone/PAN must
    # not be shared between two registrations (spec 3.5 duplicate check).
    email = Column(String, nullable=False, unique=True)
    phone = Column(String, nullable=True, unique=True)

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


# How far ahead a document is flagged "expiring" (spec 3.5 doesn't give a window).
EXPIRY_WARNING_DAYS = 30


class VendorDocType(str, enum.Enum):
    """Spec §3.2's KYC checklist, fixed rather than freeform (same reasoning
    as Category Declaration's move to checkboxes — a known set beats
    free text nobody downstream can rely on matching)."""

    GST_CERTIFICATE = "gst_certificate"
    PAN_CARD = "pan_card"
    INCORPORATION_CERTIFICATE = "incorporation_certificate"
    BANK_PROOF = "bank_proof"
    # Statutory / compliance (spec 3.2: "Yes (as applicable)") -- these carry expiry dates.
    BUSINESS_LICENSE = "business_license"
    DRUG_LICENSE = "drug_license"
    MSME_UDYAM = "msme_udyam"
    ISO_CERTIFICATE = "iso_certificate"
    # Spec 3.2 Document Uploads: sample product catalog / price list.
    SAMPLE_CATALOG = "sample_catalog"
    # Anything else a catalog entry asks for, named by free text
    # (VendorDocument.custom_label) and read by the human reviewer.
    OTHER = "other"


# Mandatory = the rows the spec marks plain "Yes": banking (cancelled cheque /
# bank letter) and Document Uploads (incorporation certificate, tax
# registration, sample catalogue / price list). The statutory licences and the
# ISO / quality certificate are "Yes (as applicable)", i.e. optional here.
DOC_TYPE_LABELS = {
    "gst_certificate": "GST Certificate",
    "pan_card": "PAN Card",
    "incorporation_certificate": "Certificate of Incorporation",
    "bank_proof": "Cancelled Cheque / Bank Letter",
    "business_license": "Business Licence",
    "drug_license": "Drug Licence",
    "msme_udyam": "MSME / Udyam Registration",
    "iso_certificate": "ISO / Quality Certificate",
    "sample_catalog": "Sample Product Catalog / Price List",
    "other": "Other document",
}

OTHER_PREFIX = "other:"  # required_documents entry for a free-text requirement, e.g. "other:CE marking certificate"


def requirement_key(entry: str) -> str:
    """Normalised lookup key for a required_documents entry (free-text ones are case-insensitive)."""
    return OTHER_PREFIX + entry[len(OTHER_PREFIX):].strip().casefold() if entry.startswith(OTHER_PREFIX) else entry


def requirement_label(entry: str) -> str:
    if entry.startswith(OTHER_PREFIX):
        return entry[len(OTHER_PREFIX):].strip()
    return DOC_TYPE_LABELS.get(entry, entry)

MANDATORY_DOC_TYPES = {
    VendorDocType.GST_CERTIFICATE,
    VendorDocType.PAN_CARD,
    VendorDocType.INCORPORATION_CERTIFICATE,
    VendorDocType.BANK_PROOF,
    VendorDocType.SAMPLE_CATALOG,
}


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
    __table_args__ = (UniqueConstraint("vendor_id", "doc_type", "custom_label", name="uq_vendor_doctype_label"),)

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    doc_type = Column(Enum(VendorDocType), nullable=False)
    # Only for doc_type OTHER: what the document is (empty string otherwise,
    # so the unique constraint above treats standard types as one per vendor).
    custom_label = Column(String, nullable=False, default="")

    original_filename = Column(String, nullable=False)
    content_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=False)
    content = Column(LargeBinary, nullable=False)

    status = Column(Enum(DocumentStatus), nullable=False, default=DocumentStatus.PENDING)
    rejection_reason = Column(Text, nullable=True)
    reviewed_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Spec 3.5: statutory documents carry expiry dates. Optional per document
    # (a GST certificate doesn't expire; a licence does).
    valid_till = Column(Date, nullable=True)

    vendor = relationship("Vendor", back_populates="documents")

    @property
    def requirement_key(self) -> str:
        """The key a product/category requirement resolves to (see requirement_key())."""
        if self.doc_type == VendorDocType.OTHER:
            return OTHER_PREFIX + self.custom_label.strip().casefold()
        return self.doc_type.value

    @property
    def expiry_state(self) -> str:
        """none (no expiry date) | ok | expiring (within EXPIRY_WARNING_DAYS) | expired."""
        if self.valid_till is None:
            return "none"
        today = date.today()
        if self.valid_till < today:
            return "expired"
        if self.valid_till <= today + timedelta(days=EXPIRY_WARNING_DAYS):
            return "expiring"
        return "ok"


class VendorStatusHistory(Base):
    """One row per vendor status change (spec 3.4 / 3.5): who moved a vendor
    between Pending / Info Requested / Active / Suspended / Rejected /
    Blacklisted, and why. Never edited or deleted."""

    __tablename__ = "vendor_status_history"

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False, index=True)
    from_status = Column(Enum(VendorStatus), nullable=True)
    to_status = Column(Enum(VendorStatus), nullable=False)
    reason = Column(Text, nullable=True)
    actor_id = Column(Integer, nullable=True)  # user_accounts.id; null = system / the vendor's own registration
    at = Column(DateTime(timezone=True), server_default=func.now())
