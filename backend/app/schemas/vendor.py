from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator

from app.models.vendor import VendorStatus

# Spec §3.5: "Duplicate registration by GSTIN/PAN is blocked at submission."
# A real GSTIN is 15 chars (2-digit state code + 10-char PAN + entity/checksum);
# this is a format sanity check, not a statutory verification (that's the
# GST/PAN Verification API adapter, out of scope for this pass).
GSTIN_LENGTH = 15


class VendorCreate(BaseModel):
    legal_name: str
    gstin: str
    pan: str | None = None
    contact_person: str
    email: EmailStr
    phone: str | None = None
    category_declaration: str | None = None
    # Sets the vendor's own login immediately (no vendor portal existed
    # before this; no email/SMS adapter exists to deliver a temp password
    # later, so "choose your own now" is the only path that doesn't need one).
    password: str

    @field_validator("gstin")
    @classmethod
    def gstin_format(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != GSTIN_LENGTH:
            raise ValueError(f"GSTIN must be {GSTIN_LENGTH} characters")
        return v

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
    contact_person: str
    email: str
    phone: str | None
    category_declaration: str | None
    rejection_reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


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
