import re
from datetime import date, datetime

from pydantic import BaseModel, EmailStr, field_validator, model_validator

from app.models.vendor import VendorStatus

# Spec §3.5: "Duplicate registration by GSTIN/PAN is blocked at submission."
# A real GSTIN is 15 chars (2-digit state code + 10-char PAN + entity/checksum);
# this is a format sanity check, not a statutory verification (that's the
# GST/PAN Verification API adapter, out of scope for this pass).
GSTIN_LENGTH = 15
# Spec 3.3 step 2: GSTIN/PAN format check (format only, not statutory verification).
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$")
PAN_RE = re.compile(r"^[A-Z]{5}\d{4}[A-Z]$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z\d]{6}$")
ENTITY_TYPES = ["Private Limited", "Public Limited", "LLP", "Partnership", "Proprietorship", "Other"]


class VendorCreate(BaseModel):
    legal_name: str
    gstin: str
    pan: str
    trade_name: str | None = None
    entity_type: str
    year_of_incorporation: int
    registered_address: str
    branch_locations: str | None = None
    bank_name: str
    bank_account_number: str
    bank_ifsc: str
    contact_person: str
    contact_designation: str
    email: EmailStr
    phone: str
    escalation_contact_name: str
    escalation_contact_phone: str
    escalation_contact_email: str | None = None
    payment_terms: str | None = None
    delivery_lead_time_days: int | None = None
    min_order_value: float | None = None
    category_declaration: str | None = None
    # Sets the vendor's own login immediately (no vendor portal existed
    # before this; no email/SMS adapter exists to deliver a temp password
    # later, so "choose your own now" is the only path that doesn't need one).
    password: str

    @field_validator("gstin")
    @classmethod
    def gstin_format(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != GSTIN_LENGTH or not GSTIN_RE.match(v):
            raise ValueError("GSTIN must be 15 characters in the standard format (e.g. 27AAAPM1234C1Z5)")
        return v

    @field_validator("entity_type")
    @classmethod
    def entity_type_known(cls, v: str) -> str:
        if v not in ENTITY_TYPES:
            raise ValueError(f"Entity type must be one of: {', '.join(ENTITY_TYPES)}")
        return v

    @field_validator("year_of_incorporation")
    @classmethod
    def year_sane(cls, v: int) -> int:
        if not 1800 <= v <= date.today().year:
            raise ValueError("Enter a valid year of incorporation")
        return v

    @field_validator("bank_ifsc")
    @classmethod
    def ifsc_format(cls, v: str) -> str:
        v = v.strip().upper()
        if not IFSC_RE.match(v):
            raise ValueError("IFSC must be 11 characters (4 letters, a 0, then 6 letters/digits)")
        return v

    @field_validator("bank_account_number")
    @classmethod
    def account_number(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or not 6 <= len(v) <= 20:
            raise ValueError("Bank account number must be 6 to 20 digits")
        return v

    @field_validator("registered_address", "bank_name", "contact_designation", "escalation_contact_name", "legal_name", "contact_person")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("This field is required")
        return v

    @field_validator("escalation_contact_phone")
    @classmethod
    def escalation_phone(cls, v: str) -> str:
        cleaned = "".join(ch for ch in v if ch.isdigit() or ch == "+")
        if len(cleaned.lstrip("+")) < 7:
            raise ValueError("Enter a valid escalation phone number")
        return cleaned

    @field_validator("email")
    @classmethod
    def email_lowercase(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("pan")
    @classmethod
    def pan_uppercase(cls, v: str) -> str:
        v = v.strip().upper()
        if not PAN_RE.match(v):
            raise ValueError("PAN must be 10 characters in the standard format (e.g. AAAPM1234C)")
        return v

    @field_validator("phone")
    @classmethod
    def phone_normalised(cls, v: str) -> str:
        # Digits and a leading + only, so "98200 11122" and "9820011122" clash.
        cleaned = "".join(ch for ch in v if ch.isdigit() or ch == "+")
        if len(cleaned.lstrip("+")) < 7:
            raise ValueError("Enter a valid phone number")
        return cleaned

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class VendorLookupOut(BaseModel):
    """Minimal, non-sensitive projection for picking a vendor by name
    elsewhere in the app (Vendor Mapping, Vendor Rating) — deliberately
    excludes GSTIN/PAN/contact details, which stay behind the
    Procurement-Admin-only `GET /vendors` full listing."""

    id: int
    legal_name: str
    status: VendorStatus

    model_config = {"from_attributes": True}


class VendorOut(BaseModel):
    id: int
    status: VendorStatus
    legal_name: str
    gstin: str
    pan: str | None
    trade_name: str | None
    entity_type: str | None
    year_of_incorporation: int | None
    registered_address: str | None
    branch_locations: str | None
    bank_name: str | None
    bank_account_number: str | None
    bank_ifsc: str | None
    contact_person: str
    contact_designation: str | None
    email: str
    phone: str | None
    escalation_contact_name: str | None
    escalation_contact_phone: str | None
    escalation_contact_email: str | None
    payment_terms: str | None
    delivery_lead_time_days: int | None
    min_order_value: float | None
    category_declaration: str | None
    rejection_reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# Personal / financial identifiers staff must not see by default. The staff
# API returns MASK for these; a staff member re-enters their own password to
# reveal one (POST /vendors/{id}/reveal). The vendor's own views are unmasked.
SENSITIVE_FIELDS = ("gstin", "pan", "bank_account_number", "bank_ifsc", "phone", "escalation_contact_phone")
MASK = "•" * 8


class VendorMaskedOut(VendorOut):
    """VendorOut as staff see it: sensitive fields replaced by MASK (null stays null)."""

    @model_validator(mode="after")
    def mask_sensitive(self):
        for name in SENSITIVE_FIELDS:
            if getattr(self, name):
                setattr(self, name, MASK)
        return self


class VendorRevealRequest(BaseModel):
    field: str
    password: str

    @field_validator("field")
    @classmethod
    def known_field(cls, v: str) -> str:
        if v not in SENSITIVE_FIELDS:
            raise ValueError("That field can't be revealed")
        return v


class VendorRevealOut(BaseModel):
    field: str
    value: str | None


class VendorStatusHistoryOut(BaseModel):
    id: int
    from_status: VendorStatus | None
    to_status: VendorStatus
    reason: str | None
    actor_id: int | None
    at: datetime

    model_config = {"from_attributes": True}


class VendorReinstatement(BaseModel):
    """Optional for lifting a suspension; mandatory (enforced in the router)
    for reinstating a blacklisted vendor."""

    reason: str | None = None


class VendorRejection(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        # Spec §3.3 point 5 / §3.5: rejection always carries a reason.
        if not v or not v.strip():
            raise ValueError("A reason is required")
        return v.strip()


class VendorInfoRequest(BaseModel):
    """Sending a vendor back to Info Requested (e.g. after rejecting a
    mandatory document) always carries a note explaining what's needed --
    same reasoning as rejection needing a reason."""

    note: str

    @field_validator("note")
    @classmethod
    def note_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A note is required")
        return v.strip()
