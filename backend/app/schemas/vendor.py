import re
from datetime import date, datetime

from pydantic import BaseModel, EmailStr, field_validator, model_validator

from app.models.vendor import VendorStatus
from app.schemas.password import check_password_strength
from app.schemas.validators import require_reason

# Spec §3.5: "Duplicate registration by GSTIN/PAN is blocked at submission."
# A real GSTIN is 15 chars (2-digit state code + 10-char PAN + entity/checksum);
# this is a format sanity check, not a statutory verification (that's the
# GST/PAN Verification API adapter, out of scope for this pass).
GSTIN_LENGTH = 15
# Spec 3.3 step 2: GSTIN/PAN format check (format only, not statutory verification).
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$")
PAN_RE = re.compile(r"^[A-Z]{5}\d{4}[A-Z]$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z\d]{6}$")
PINCODE_RE = re.compile(r"^\d{6}$")
# Real Indian bank account numbers vary 9-18 digits depending on the bank --
# format sanity check only (same as GSTIN/PAN/IFSC above), not a statutory
# account-exists verification (that's the Finance/ERP adapter, out of scope).
ACCOUNT_NUMBER_RE = re.compile(r"^\d{9,18}$")
ENTITY_TYPES = ["Private Limited", "Public Limited", "LLP", "Partnership", "Proprietorship", "Other"]


def _length_bounds(label: str, min_len: int, max_len: int, optional: bool = False):
    """These name/address fields had no length constraint at all server-side
    until now -- just non-blank -- with the bounds only enforced in
    registerValidation.ts's own boundedText(), a deliberate, user-directed
    choice (2026-10-13) to treat them as a pure client-side data-quality
    rule. Reversed 2026-10-23 (user-directed): a direct API call bypassing
    the form could otherwise submit a 1-character legal name or a
    10,000-character address. Mirrors boundedText() exactly -- same
    labels, same bounds -- so nothing valid on the frontend is ever
    rejected here, and vice versa."""

    def check(v: str | None) -> str | None:
        if v is None or not v.strip():
            if optional:
                return v
            raise ValueError(f"{label} is required")
        v = v.strip()
        if len(v) < min_len:
            raise ValueError(f"{label} must be at least {min_len} characters")
        if len(v) > max_len:
            raise ValueError(f"{label} must be {max_len} characters or fewer")
        return v

    return check


class VendorCreate(BaseModel):
    legal_name: str
    gstin: str
    pan: str
    trade_name: str | None = None
    entity_type: str
    year_of_incorporation: int
    registered_address: str
    # Structured (2026-10-01), not buried in the free-text address line above --
    # this is what makes "vendors in a given location" a real, queryable thing
    # later rather than text someone would have to parse by hand.
    city: str
    state: str
    pincode: str
    branch_locations: str | None = None
    alternate_address: str | None = None
    website: str | None = None
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
    # Carries an Open Tender self-registration link's token through to
    # require_open_link_tender() (not a Vendor column -- excluded from
    # model_dump() wherever this schema builds a Vendor row). Optional: most
    # registrations don't arrive via such a link.
    open_link_token: str | None = None

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
    def account_number_format(cls, v: str) -> str:
        v = v.strip()
        if not ACCOUNT_NUMBER_RE.match(v):
            raise ValueError("Account number must be 9-18 digits")
        return v

    @field_validator("bank_name", "city", "state")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("This field is required")
        return v

    _legal_name_len = field_validator("legal_name")(_length_bounds("Legal name", 2, 100))
    _trade_name_len = field_validator("trade_name")(_length_bounds("Trade name", 2, 100, optional=True))
    _address_len = field_validator("registered_address")(_length_bounds("Address line", 10, 250))
    _alt_address_len = field_validator("alternate_address")(_length_bounds("Alternate / correspondence address", 1, 250, optional=True))
    _contact_person_len = field_validator("contact_person")(_length_bounds("Primary contact person", 2, 50))
    _contact_designation_len = field_validator("contact_designation")(_length_bounds("Designation", 2, 50))
    _escalation_name_len = field_validator("escalation_contact_name")(_length_bounds("Escalation contact name", 2, 50))

    @field_validator("pincode")
    @classmethod
    def pincode_format(cls, v: str) -> str:
        v = v.strip()
        if not PINCODE_RE.match(v):
            raise ValueError("Pincode must be 6 digits")
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

    _pw = field_validator("password")(check_password_strength)


class VendorDuplicateCheckRequest(BaseModel):
    """Lightweight pre-flight check (2026-10-13, user-requested): lets the
    registration form's Step 1 "Continue" catch an already-registered
    GSTIN/PAN/email/phone immediately, rather than only discovering it at
    final submit after Step 2's documents are already filled in. Every field
    optional and un-validated here on purpose -- the client only ever sends
    whatever Step 1 fields it already format-validated itself, and a blank
    field is simply skipped rather than treated as an error."""

    gstin: str = ""
    pan: str = ""
    email: str = ""
    phone: str = ""


class VendorDuplicateCheckResponse(BaseModel):
    """One message per field that's already taken, `None` for a field that's
    free (or wasn't sent) -- same wording register_vendor() itself raises,
    so Step 1's inline error and the final submit's error never disagree."""

    gstin: str | None = None
    pan: str | None = None
    email: str | None = None
    phone: str | None = None


class VendorDraftOut(BaseModel):
    """Registration's new first step (2026-10-13) -- deliberately NOT
    VendorOut: nothing else about the draft vendor is exposed here, just
    enough for the browser to attach documents to it and finish
    registration, since there's no login yet to scope those calls by."""

    id: int
    registration_token: str
    email_verified: bool = False


class VendorDraftUpdate(BaseModel):
    """Spec §3.5 recovery, 2026-10-21: a vendor who logs back in while still
    Draft (e.g. the verification email never reached them) is sent back to
    Step 1 prefilled and editable, then saved through this -- the *update*
    counterpart to VendorCreate's *create*. Not a VendorCreate subclass:
    tried reusing VendorCreate's own validator methods directly (both as a
    subclass override and by rebinding the already-decorated classmethods
    here) -- a subclass field_validator doesn't replace the parent's for
    the same field, and rebinding an already-pydantic-wrapped classmethod
    onto a different model breaks its argument binding outright (confirmed
    both ways, not assumed). Same validation rules as VendorCreate,
    duplicated rather than fought over -- plain and explicit beats clever
    here. Same fields as VendorCreate, **minus password** (no plaintext
    round-trip of a password that's already hashed -- same reasoning
    StaffFormDialog.tsx already uses: no password field at all when
    editing, only on create; a vendor changes their password by actually
    typing a new one in, which this isn't for)."""

    legal_name: str
    gstin: str
    pan: str
    trade_name: str | None = None
    entity_type: str
    year_of_incorporation: int
    registered_address: str
    city: str
    state: str
    pincode: str
    branch_locations: str | None = None
    alternate_address: str | None = None
    website: str | None = None
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
    registration_token: str

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
    def account_number_format(cls, v: str) -> str:
        v = v.strip()
        if not ACCOUNT_NUMBER_RE.match(v):
            raise ValueError("Account number must be 9-18 digits")
        return v

    @field_validator("bank_name", "city", "state")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("This field is required")
        return v

    _legal_name_len = field_validator("legal_name")(_length_bounds("Legal name", 2, 100))
    _trade_name_len = field_validator("trade_name")(_length_bounds("Trade name", 2, 100, optional=True))
    _address_len = field_validator("registered_address")(_length_bounds("Address line", 10, 250))
    _alt_address_len = field_validator("alternate_address")(_length_bounds("Alternate / correspondence address", 1, 250, optional=True))
    _contact_person_len = field_validator("contact_person")(_length_bounds("Primary contact person", 2, 50))
    _contact_designation_len = field_validator("contact_designation")(_length_bounds("Designation", 2, 50))
    _escalation_name_len = field_validator("escalation_contact_name")(_length_bounds("Escalation contact name", 2, 50))

    @field_validator("pincode")
    @classmethod
    def pincode_format(cls, v: str) -> str:
        v = v.strip()
        if not PINCODE_RE.match(v):
            raise ValueError("Pincode must be 6 digits")
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
        cleaned = "".join(ch for ch in v if ch.isdigit() or ch == "+")
        if len(cleaned.lstrip("+")) < 7:
            raise ValueError("Enter a valid phone number")
        return cleaned


class VendorEmailCodeRequest(BaseModel):
    registration_token: str


class VendorEmailVerifyRequest(BaseModel):
    registration_token: str
    code: str


class VendorCompleteRegistration(BaseModel):
    registration_token: str


class VendorLookupOut(BaseModel):
    """Minimal, non-sensitive projection for picking a vendor by name
    elsewhere in the app (Vendor Mapping, Vendor Rating) — deliberately
    excludes GSTIN/PAN/contact details, which stay behind the
    Category-Manager-only `GET /vendors` full listing."""

    id: int
    legal_name: str
    status: VendorStatus

    model_config = {"from_attributes": True}


class VendorCommercialTermsUpdate(BaseModel):
    """Self-service update, spec §3.2's optional commercial terms -- no
    longer collected at registration; a vendor can set/change these any time
    from Company profile since they're informational, not a gate on anything."""

    payment_terms: str | None = None
    delivery_lead_time_days: int | None = None
    min_order_value: float | None = None

    @field_validator("delivery_lead_time_days")
    @classmethod
    def lead_time_non_negative(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("Delivery lead time can't be negative")
        return v

    @field_validator("min_order_value")
    @classmethod
    def min_order_non_negative(cls, v: float | None) -> float | None:
        if v is not None and v < 0:
            raise ValueError("Minimum order value can't be negative")
        return v


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
    city: str | None
    state: str | None
    pincode: str | None
    branch_locations: str | None
    alternate_address: str | None
    website: str | None
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
    # Added 2026-10-21 so a vendor who logs back in while still Draft (login
    # never checks status except Blacklisted) has everything the frontend
    # needs to resume registration from GET /vendor-auth/me alone -- no
    # separate "fetch my draft" endpoint. The `registration_token` column is
    # never cleared once registration completes, so it's nulled out below
    # for anything past Draft rather than leaking a now-useless token.
    registration_token: str | None = None
    email_verified: bool = False
    # Spec §6.7/§12.3 "Expedited Registration Review" (see models/vendor.py) --
    # set once that override is Approved; informational only.
    expedited_review_tender_id: int | None = None
    expedited_review_requested_at: datetime | None = None

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def hide_token_once_not_draft(self):
        if self.status != VendorStatus.DRAFT:
            self.registration_token = None
        return self

    @classmethod
    def from_vendor(cls, vendor) -> "VendorOut":
        out = cls.model_validate(vendor)
        out.email_verified = vendor.email_verified_at is not None
        return out


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
        # Staff never do the registration_token-authorized draft flow --
        # unlike VendorOut's own Draft-only nulling above, this one's
        # unconditional, same reasoning as the sensitive fields above.
        self.registration_token = None
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


class ExpeditedReviewRequest(BaseModel):
    """Spec §6.7/§12.3, reframed as "Expedited Registration Review" (see
    models/vendor.py's expedited_review_tender_id) -- a Procurement Officer
    or Category Manager flagging an already-registered, still-pending
    vendor's review as high priority against a tender deadline."""

    tender_id: int
    reason_code: str
    justification: str


class VendorStatusHistoryOut(BaseModel):
    id: int
    from_status: VendorStatus | None
    to_status: VendorStatus
    reason: str | None
    actor_id: int | None
    actor_name: str | None = None
    at: datetime

    model_config = {"from_attributes": True}


class VendorHistoryEntryOut(BaseModel):
    """Bug report, 2026-10-14: the vendor profile's "Status History" only
    ever showed status transitions (VendorStatusHistory), even though
    document uploads/replacements/deletions/verify/reject decisions were
    already being recorded faithfully -- just in the audit log, which this
    screen never read from. This is the merged shape GET
    /vendors/{id}/status-history now returns: a VendorStatusHistory row
    (from_status/to_status set, label unset) or a document-related audit_log
    row (label set, from_status/to_status unset), sorted together by time.
    `id` is prefixed ("status-12" / "doc-345") since the two source tables'
    own ids aren't unique against each other."""

    id: str
    at: datetime
    from_status: VendorStatus | None = None
    to_status: VendorStatus | None = None
    label: str | None = None
    reason: str | None = None
    # Real bug, found 2026-10-24: this merged history named no one, on
    # either branch -- a status row only ever had actor_id (never resolved
    # to a name), and a document-action row had AuditLog.actor_name sitting
    # right there but it was never copied into this response shape.
    actor_name: str | None = None


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
        return require_reason(v)


class VendorInfoRequest(BaseModel):
    """Sending a vendor back to Info Requested (e.g. after rejecting a
    mandatory document) always carries a note explaining what's needed --
    same reasoning as rejection needing a reason."""

    note: str

    @field_validator("note")
    @classmethod
    def note_required(cls, v: str) -> str:
        return require_reason(v)
