from app.services.guest_invite_links import invite_newly_active_vendor, require_guest_invite_tender
import logging
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.tender import Tender, TenderStatus
from app.models.user_account import Role, UserAccount
from app.models.vendor import (
    MANDATORY_DOC_TYPES,
    DocumentStatus,
    Vendor,
    VendorDocType,
    VendorDocument,
    VendorStatus,
    VendorStatusHistory,
)
from app.schemas.vendor import (
    ExpeditedReviewRequest,
    VendorCompleteRegistration,
    VendorCreate,
    VendorDraftOut,
    VendorDraftUpdate,
    VendorDuplicateCheckRequest,
    VendorDuplicateCheckResponse,
    VendorEmailCodeRequest,
    VendorEmailVerifyRequest,
    VendorHistoryEntryOut,
    VendorInfoRequest,
    VendorLookupOut,
    VendorMaskedOut,
    VendorOut,
    VendorRevealOut,
    VendorRevealRequest,
    VendorReinstatement,
    VendorRejection,
)
from app.schemas.vendor_document import VendorDocumentOut, VendorDocumentRejection
from app.routers.vendor_documents import store_document
from app.security import get_current_user, hash_password, require_role, verify_password
from app.schemas.vendor_document import ItemRequirementOut
from app.services.audit import record
from app.services.document_requirements import to_out, vendor_requirements
from app.services.email_adapter import send_email
from app.services.expiry import reinstate_if_cleared
from app.services.notifier import notify_vendor
from app.services.vendor_status import set_status

logger = logging.getLogger(__name__)


def doc_label(doc: VendorDocument) -> str:
    return doc.custom_label if doc.doc_type.value == "other" else doc.doc_type.value.replace("_", " ")
router = APIRouter(prefix="/api/v1/vendors", tags=["vendors"])

# Vendor status/document review moved off Category Manager entirely
# (2026-10-26, user-directed: "the system admin to take care of the vendor
# document approval and nobody else" -- Category Manager keeps Mapping and
# Ratings, nothing vendor-queue-related).
VENDOR_DECISION_ROLES = (Role.SYSTEM_ADMIN,)

# Spec §3.4: only these two statuses are legal starting points for an
# admin decision. An already-Active or already-Rejected vendor can't be
# re-decided through this endpoint (a status change from there is a
# different workflow, e.g. suspension — not built in this pass).
DECIDABLE_STATUSES = {VendorStatus.PENDING_VERIFICATION, VendorStatus.INFO_REQUESTED}

# Spec §6.7/§12.3: the default approver for Expedited Registration Review is
# Procurement Officer (self-attested), escalating to Category Manager -- a
# different set from VENDOR_DECISION_ROLES above, which never included
# Procurement Officer at all (vendor approve/reject/suspend stays
# Category-Manager-only).
EXPEDITE_REQUESTERS = (Role.PROCUREMENT_OFFICER, Role.CATEGORY_MANAGER, Role.SYSTEM_ADMIN)

# User-directed (2026-09-30): Request Info is also a lighter alternative to
# outright Suspend for an Active vendor whose document gets rejected during
# an ongoing review (e.g. a re-uploaded KYC document, or an item-specific
# requirement), and an alternative recovery path for an already-Suspended
# one -- either way it reuses the exact same "vendor uploads something ->
# back to Pending Verification" mechanism as a fresh registration.
INFO_REQUESTABLE_STATUSES = DECIDABLE_STATUSES | {VendorStatus.ACTIVE, VendorStatus.SUSPENDED}


# Document slots on the registration form: (form field, doc type, mandatory).
# Optional ones are the statutory "as applicable" licences / certificates.
REGISTRATION_DOCS = [
    ("gst_certificate", VendorDocType.GST_CERTIFICATE),
    ("pan_card", VendorDocType.PAN_CARD),
    ("incorporation_certificate", VendorDocType.INCORPORATION_CERTIFICATE),
    ("bank_proof", VendorDocType.BANK_PROOF),
    ("sample_catalog", VendorDocType.SAMPLE_CATALOG),
    ("business_license", VendorDocType.BUSINESS_LICENSE),
    ("drug_license", VendorDocType.DRUG_LICENSE),
    ("msme_udyam", VendorDocType.MSME_UDYAM),
    ("iso_certificate", VendorDocType.ISO_CERTIFICATE),
]


def _duplicate_check(db: Session, gstin: str, pan: str, email: str, phone: str, exclude_vendor_id: int | None = None) -> None:
    """Spec 3.5 duplicate check + 6.8.2 point 3 (Open Tender self-registration
    matches an existing profile instead of duplicating). GSTIN, PAN, email
    and phone must each be unique to one vendor (each a DB `unique=True`
    column, app/models/vendor.py). Shared by create_draft_vendor() and
    check_vendor_duplicates() -- one rule, one wording, not copy-pasted.
    `exclude_vendor_id` (2026-10-21): update_draft_vendor() runs this same
    check against a vendor's *own* already-saved values -- without this,
    resaving your own GSTIN/email/etc. unchanged would 409 against yourself."""
    for column, value, label in (
        (Vendor.gstin, gstin, "GSTIN"),
        (Vendor.pan, pan, "PAN"),
        (Vendor.email, email, "email address"),
        (Vendor.phone, phone, "phone number"),
    ):
        query = db.query(Vendor).filter(column == value)
        if exclude_vendor_id is not None:
            query = query.filter(Vendor.id != exclude_vendor_id)
        existing = query.first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A vendor with this {label} is already registered (status: {existing.status.value})",
            )


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
async def register_vendor(request: Request, db: Session = Depends(get_db)):
    """Spec 3.3 registration workflow -- the original one-request version.

    **Superseded (2026-10-13) by the three endpoints below** (create_draft_vendor
    / upload_registration_document / complete_vendor_registration) as what the
    actual registration form calls: bundling every (possibly up to 10MB each)
    mandatory document into one multipart request alongside the vendor row,
    all held in a single DB transaction until one final commit, is what made a
    registration with several large documents take minutes and occasionally
    500 (the transaction holds a SELECT+INSERT round trip to the DB per file,
    serialized, before anything commits -- see
    .claude-notes/REACT-MIGRATION-PLAN.md for the full diagnosis). Kept here,
    unchanged, as a fallback/compatibility path rather than deleted outright,
    since Open Tender self-registration and any other caller of this exact
    route aren't something this pass re-verified -- not actively used by the
    frontend form anymore, flagged as a cleanup candidate once that's confirmed.

    Multipart: every spec 3.2 field group plus the documents. The vendor row
    and all documents are saved in one transaction, so a registration can
    never exist without its mandatory documents (enforced here, not just by
    the form). Optional per-document expiry dates arrive as
    `valid_till_<doc field>`."""

    form = await request.form()
    text_fields = {k: (v if isinstance(v, str) else None) for k, v in form.items()}

    def number(name, cast):
        raw = (text_fields.get(name) or "").strip()
        if raw == "":
            return None
        try:
            return cast(raw)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{name}: enter a valid number")

    try:
        payload = VendorCreate(
            legal_name=text_fields.get("legal_name") or "",
            gstin=text_fields.get("gstin") or "",
            pan=text_fields.get("pan") or "",
            trade_name=(text_fields.get("trade_name") or "").strip() or None,
            entity_type=text_fields.get("entity_type") or "",
            year_of_incorporation=number("year_of_incorporation", int) or 0,
            registered_address=text_fields.get("registered_address") or "",
            city=text_fields.get("city") or "",
            state=text_fields.get("state") or "",
            pincode=text_fields.get("pincode") or "",
            branch_locations=(text_fields.get("branch_locations") or "").strip() or None,
            alternate_address=(text_fields.get("alternate_address") or "").strip() or None,
            website=(text_fields.get("website") or "").strip() or None,
            bank_name=text_fields.get("bank_name") or "",
            bank_account_number=text_fields.get("bank_account_number") or "",
            bank_ifsc=text_fields.get("bank_ifsc") or "",
            contact_person=text_fields.get("contact_person") or "",
            contact_designation=text_fields.get("contact_designation") or "",
            email=text_fields.get("email") or "",
            phone=text_fields.get("phone") or "",
            escalation_contact_name=text_fields.get("escalation_contact_name") or "",
            escalation_contact_phone=text_fields.get("escalation_contact_phone") or "",
            escalation_contact_email=(text_fields.get("escalation_contact_email") or "").strip() or None,
            payment_terms=(text_fields.get("payment_terms") or "").strip() or None,
            delivery_lead_time_days=number("delivery_lead_time_days", int),
            min_order_value=number("min_order_value", float),
            password=text_fields.get("password") or "",
        )
    except ValidationError as e:
        msg = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors())
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=msg)

    _duplicate_check(db, payload.gstin, payload.pan, payload.email, payload.phone)

    uploads = {}
    for field, doc_type in REGISTRATION_DOCS:
        upload = form.get(field)
        if upload is not None and not isinstance(upload, str) and upload.filename:
            uploads[doc_type] = (field, upload)
    missing = [dt.value for dt in MANDATORY_DOC_TYPES if dt not in uploads]
    if missing:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Mandatory document(s) missing: {', '.join(sorted(missing))}")

    # Anything else the vendor wants to attach, named by them (repeated
    # other_doc_label/other_doc_file pairs, same order -- user-directed,
    # 2026-09-29). A row only counts once both a label and a file are given.
    other_labels = form.getlist("other_doc_label")
    other_files = form.getlist("other_doc_file")
    other_docs = [
        (label.strip(), upload)
        for label, upload in zip(other_labels, other_files)
        if label.strip() and not isinstance(upload, str) and upload.filename
    ]

    linked_tender = require_guest_invite_tender((text_fields.get("guest_invite_token") or "").strip() or None, db)
    vendor = Vendor(
        **payload.model_dump(exclude={"password", "category_declaration", "guest_invite_token"}),
        status=VendorStatus.PENDING_VERIFICATION,
        hashed_password=hash_password(payload.password),
    )
    db.add(vendor)
    if linked_tender is not None:
        vendor.registered_via_tender_id = linked_tender.id
    db.flush()
    db.add(VendorStatusHistory(vendor_id=vendor.id, from_status=None, to_status=VendorStatus.PENDING_VERIFICATION, reason="Registered"))
    record(
        db, "vendor.registered", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name,
        after={"status": VendorStatus.PENDING_VERIFICATION}, reason="Registered",
    )
    for doc_type, (field, upload) in uploads.items():
        raw_date = (text_fields.get(f"valid_till_{field}") or "").strip()
        try:
            valid_till = date.fromisoformat(raw_date) if raw_date else None
        except ValueError:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"valid_till_{field}: enter a valid date")
        store_document(db, vendor.id, doc_type, upload.filename, upload.content_type, await upload.read(), valid_till)
    for label, upload in other_docs:
        store_document(db, vendor.id, VendorDocType.OTHER, upload.filename, upload.content_type, await upload.read(), custom_label=label)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/draft", response_model=VendorDraftOut, status_code=status.HTTP_201_CREATED)
def create_draft_vendor(payload: VendorCreate, db: Session = Depends(get_db)):
    """Registration's new first step (2026-10-13, user-requested). Creates
    the vendor row immediately in DRAFT status, with no documents at all --
    each one is uploaded separately right after this, through
    `POST /{vendor_id}/documents`, each in its own small transaction instead
    of being bundled with every other document and the vendor row itself
    into one giant transaction (`register_vendor` above, superseded by this
    for the actual registration form -- see its own docstring for the full
    diagnosis of why that was slow/unreliable with several large documents).
    `complete_vendor_registration` below is what checks every mandatory
    document is present and moves this to Pending Verification; nothing
    here does yet. JSON, not multipart -- there's nothing to attach here.

    Unauthenticated, same as register_vendor() -- a prospective vendor has
    no token yet. The returned `registration_token` is the only thing that
    lets this same (still-anonymous) browser prove it's the one allowed to
    attach documents to this draft or finish it -- same capability-token
    pattern as guest_invite_links.py's guest_invite_token."""

    _duplicate_check(db, payload.gstin, payload.pan, payload.email, payload.phone)

    linked_tender = require_guest_invite_tender((payload.guest_invite_token or "").strip() or None, db)
    token = secrets.token_urlsafe(32)
    vendor = Vendor(
        **payload.model_dump(exclude={"password", "category_declaration", "guest_invite_token"}),
        status=VendorStatus.DRAFT,
        hashed_password=hash_password(payload.password),
        registration_token=token,
    )
    db.add(vendor)
    if linked_tender is not None:
        vendor.registered_via_tender_id = linked_tender.id
    db.flush()
    db.add(VendorStatusHistory(vendor_id=vendor.id, from_status=None, to_status=VendorStatus.DRAFT, reason="Registration started"))
    record(
        db, "vendor.registration_started", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name,
        after={"status": VendorStatus.DRAFT}, reason="Registration started",
    )
    db.commit()
    db.refresh(vendor)
    return VendorDraftOut(id=vendor.id, registration_token=token)


def _authorize_draft(db: Session, vendor_id: int, registration_token: str) -> Vendor:
    """Shared by upload_registration_document() and
    complete_vendor_registration() -- the registration_token has to match
    AND the vendor has to still actually be Draft (so a token can't be
    replayed after registration already completed, or reused against a
    vendor some staff decision has since moved elsewhere)."""
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if vendor is None or vendor.status != VendorStatus.DRAFT or not vendor.registration_token or vendor.registration_token != registration_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or expired registration session")
    return vendor


@router.put("/{vendor_id}/draft", response_model=VendorDraftOut)
def update_draft_vendor(vendor_id: int, payload: VendorDraftUpdate, db: Session = Depends(get_db)):
    """Registration recovery, 2026-10-21: a vendor who logged back in while
    still Draft (vendor_auth.py's login never checks status except
    Blacklisted) is sent back to Step 1 prefilled and editable -- this is
    what Continue/Save-as-Draft call to actually persist those edits onto
    the *existing* draft, the update counterpart to create_draft_vendor()
    above. `exclude_vendor_id` on the duplicate check is what makes this
    different from that one: resaving this vendor's own GSTIN/PAN/email/
    phone unchanged must not 409 against itself."""

    vendor = _authorize_draft(db, vendor_id, payload.registration_token)
    _duplicate_check(db, payload.gstin, payload.pan, payload.email, payload.phone, exclude_vendor_id=vendor.id)

    for field, value in payload.model_dump(exclude={"registration_token"}).items():
        setattr(vendor, field, value)
    db.commit()
    db.refresh(vendor)
    return VendorDraftOut(id=vendor.id, registration_token=vendor.registration_token, email_verified=vendor.email_verified_at is not None)


@router.get("/{vendor_id}/draft-documents", response_model=list[VendorDocumentOut])
def list_draft_documents(vendor_id: int, registration_token: str, db: Session = Depends(get_db)):
    """Registration recovery, 2026-10-21: resuming at Step 2 needs to know
    what's already uploaded (store_document() during registration always
    writes draft=False -> DocumentStatus.PENDING, never DRAFT -- see its
    own docstring), so the dropzones can show them as done instead of
    demanding a re-upload of something already on file. Same query as
    list_vendor_documents_for_review() below, just registration_token-
    authorized instead of staff-role-gated, since there's no login yet a
    Draft vendor could use the normal way."""

    _authorize_draft(db, vendor_id, registration_token)
    return (
        db.query(VendorDocument)
        .filter(VendorDocument.vendor_id == vendor_id, VendorDocument.status != DocumentStatus.DRAFT)
        .order_by(VendorDocument.doc_type)
        .all()
    )


EMAIL_CODE_LIFETIME_MINUTES = 10


@router.post("/{vendor_id}/send-verification-code", status_code=status.HTTP_204_NO_CONTENT)
def send_verification_code(vendor_id: int, payload: VendorEmailCodeRequest, db: Session = Depends(get_db)):
    """User-directed (2026-10-19): proves the registrant actually controls
    the Step 1 email, not just that it's shaped like one. Callable again to
    resend -- each call overwrites any previous code/expiry, so only the
    most recently sent code is ever valid. A direct send_email() call, not
    notify_vendor() -- this is a one-off transactional code, not something
    that belongs in the vendor's portal notification list (which doesn't
    exist yet for a Draft vendor anyway)."""

    vendor = _authorize_draft(db, vendor_id, payload.registration_token)
    code = f"{secrets.randbelow(1_000_000):06d}"
    vendor.email_verification_code = code
    vendor.email_verification_expires_at = datetime.now(timezone.utc) + timedelta(minutes=EMAIL_CODE_LIFETIME_MINUTES)
    db.commit()
    send_email(
        vendor.email, "Verify your email - MedSource registration",
        f"Your verification code is {code}. It expires in {EMAIL_CODE_LIFETIME_MINUTES} minutes. "
        "If you didn't start a MedSource vendor registration, you can ignore this email.",
    )


@router.post("/{vendor_id}/verify-email-code", response_model=VendorDraftOut)
def verify_email_code(vendor_id: int, payload: VendorEmailVerifyRequest, db: Session = Depends(get_db)):
    vendor = _authorize_draft(db, vendor_id, payload.registration_token)
    if (
        not vendor.email_verification_code
        or vendor.email_verification_expires_at is None
        or datetime.now(timezone.utc) > vendor.email_verification_expires_at
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That code has expired. Request a new one.")
    if payload.code.strip() != vendor.email_verification_code:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That code doesn't match.")
    vendor.email_verified_at = datetime.now(timezone.utc)
    vendor.email_verification_code = None
    vendor.email_verification_expires_at = None
    db.commit()
    return VendorDraftOut(id=vendor.id, registration_token=payload.registration_token, email_verified=True)


@router.post("/{vendor_id}/documents", response_model=VendorDocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_registration_document(
    vendor_id: int,
    registration_token: str = Form(...),
    doc_type: VendorDocType = Form(...),
    custom_label: str | None = Form(None),
    valid_till: date | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """One document per request (2026-10-13, user-requested) -- its own
    small transaction (one validate + one upsert + one commit), not bundled
    with every other document into one giant one. Scoped to this one
    still-incomplete registration by `registration_token`, since there's no
    login yet to authenticate this request the normal way."""

    vendor = _authorize_draft(db, vendor_id, registration_token)
    label = (custom_label or "").strip()
    if doc_type == VendorDocType.OTHER and not label:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Say what this document is (custom_label)")
    if doc_type != VendorDocType.OTHER:
        label = ""
    content = await file.read()
    doc = store_document(db, vendor.id, doc_type, file.filename, file.content_type, content, valid_till, label)
    # Real gap, found 2026-10-15: a document upload here (registration Step
    # 2, before the vendor is even Active) went unlogged, unlike the
    # identical-looking upload once the vendor has a real account
    # (vendor_documents.py's upload_document -- same action name/meta shape
    # so it flows straight into vendor_status_history()'s existing
    # DOCUMENT_HISTORY_ACTIONS merge with no further changes needed there).
    record(
        db, "vendor.document_uploaded", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name,
        after={"status": doc.status},
        meta={"document": label or doc_type.value.replace("_", " "), "file": file.filename, "valid_till": valid_till},
    )
    db.commit()
    db.refresh(doc)
    return doc


@router.delete("/{vendor_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_registration_document(vendor_id: int, doc_id: int, registration_token: str, db: Session = Depends(get_db)):
    """Lets a dropzone's "replace" pick a different file without leaving the
    old upload behind under a stale doc_type/custom_label pairing -- not
    needed for the standard mandatory/optional slots (store_document()
    upserts by doc_type there), only for a free-label "other" document
    whose label the vendor changes after already uploading one."""
    vendor = _authorize_draft(db, vendor_id, registration_token)
    doc = db.query(VendorDocument).filter(VendorDocument.id == doc_id, VendorDocument.vendor_id == vendor.id).first()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    label = doc.custom_label or doc.doc_type.value.replace("_", " ")
    db.delete(doc)
    # Real gap, found 2026-10-15: unlogged, same reasoning as the upload
    # above -- matches vendor_documents.py's delete_my_document exactly.
    record(db, "vendor.document_deleted", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name, meta={"document": label})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{vendor_id}/complete-registration", response_model=VendorOut)
def complete_vendor_registration(vendor_id: int, payload: VendorCompleteRegistration, db: Session = Depends(get_db)):
    """Final step (2026-10-13, user-requested) -- checks every mandatory
    document has actually been uploaded (the same MANDATORY_DOC_TYPES check
    register_vendor() always did, just moved here now that documents arrive
    one at a time instead of all at once), then flips the vendor from Draft
    to Pending Verification -- the same transition registering always
    produced, just at the end of Step 2 instead of inside one giant request.
    `registration_token` is cleared so it can't be replayed afterward."""

    vendor = _authorize_draft(db, vendor_id, payload.registration_token)
    # The real gate (2026-10-19): the frontend already requires this before
    # Step 2, but that's UX only -- a direct API call skipping it must still
    # be refused here, same as every other workflow rule in this app.
    if vendor.email_verified_at is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Email not verified yet.")
    have = {d.doc_type for d in db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor.id).all()}
    missing = [dt.value for dt in MANDATORY_DOC_TYPES if dt not in have]
    if missing:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Mandatory document(s) missing: {', '.join(sorted(missing))}")

    vendor.registration_token = None
    vendor.status = VendorStatus.PENDING_VERIFICATION
    db.add(VendorStatusHistory(vendor_id=vendor.id, from_status=VendorStatus.DRAFT, to_status=VendorStatus.PENDING_VERIFICATION, reason="Registered"))
    record(
        db, "vendor.registered", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name,
        after={"status": VendorStatus.PENDING_VERIFICATION}, reason="Registered",
    )
    notify_vendor(
        db, vendor.id, kind="registered", title="Registration received",
        body=f"Thank you for registering with MedSource, {vendor.legal_name}. Your documents are now pending verification -- we'll notify you once they've been reviewed.",
    )
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/check-duplicates", response_model=VendorDuplicateCheckResponse)
def check_vendor_duplicates(payload: VendorDuplicateCheckRequest, db: Session = Depends(get_db)):
    """Lightweight pre-flight duplicate check (2026-10-13, user-requested) --
    the registration form's Step 1 "Continue" calls this before advancing to
    Step 2, so an already-registered GSTIN/PAN/email/phone surfaces right on
    the page that field is on, instead of only being discovered at the real
    submit after documents are already attached. Unauthenticated, same as
    `POST /vendors` itself -- a prospective vendor has no token yet.

    Same uniqueness rule as register_vendor()'s own check just above (GSTIN/
    PAN/email/phone are each a DB `unique=True` column on Vendor, see
    app/models/vendor.py) and the same normalization VendorCreate's own
    validators apply (uppercase GSTIN/PAN, lowercase email, phone stripped to
    digits + a leading "+"), so a match here is guaranteed to also be
    rejected by the real submit, and nothing here flags something that
    submit would actually accept. Every field is optional and independently
    checked -- a blank one is simply skipped, not an error."""

    checks: list[tuple[str, object, str, str]] = []
    if payload.gstin.strip():
        checks.append(("gstin", Vendor.gstin, payload.gstin.strip().upper(), "GSTIN"))
    if payload.pan.strip():
        checks.append(("pan", Vendor.pan, payload.pan.strip().upper(), "PAN"))
    if payload.email.strip():
        checks.append(("email", Vendor.email, payload.email.strip().lower(), "email address"))
    if payload.phone.strip():
        cleaned = "".join(ch for ch in payload.phone if ch.isdigit() or ch == "+")
        checks.append(("phone", Vendor.phone, cleaned, "phone number"))

    result: dict[str, str] = {}
    for key, column, value, label in checks:
        existing = db.query(Vendor).filter(column == value).first()
        if existing:
            result[key] = f"A vendor with this {label} is already registered (status: {existing.status.value})"
    return VendorDuplicateCheckResponse(**result)


@router.get("", response_model=list[VendorMaskedOut])
def list_vendors(
    status_filter: VendorStatus | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    query = db.query(Vendor)
    if status_filter is not None:
        query = query.filter(Vendor.status == status_filter)
    # A vendor with an approved Expedited Registration Review still sitting
    # in a decidable status sorts first -- otherwise the flag Officer raised
    # (routers/vendors.py's request_expedited_review) never actually reaches
    # the one person who acts on it. Resolved past that status, it's purely
    # historical and sorts normally again.
    is_expedited = (Vendor.expedited_review_tender_id.isnot(None)) & (Vendor.status.in_(DECIDABLE_STATUSES))
    return query.order_by(is_expedited.desc(), Vendor.created_at.desc()).all()


@router.get("/lookup", response_model=list[VendorLookupOut])
def lookup_vendors(
    status_filter: VendorStatus | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    """Backs the vendor picker on Vendor Mapping / Vendor Rating — any staff
    member needs to find a vendor by name there, not just System Admin,
    but the full `GET /vendors` listing (GSTIN/PAN/contact) stays admin-only.
    No filter by default; callers creating a new mapping pass
    `status_filter=active` (CLAUDE.md PROJECT OVERRIDE: only Active vendors
    are ever eligible for mapping/bidding), while callers resolving an
    existing mapping/rating's vendor name want every status."""

    query = db.query(Vendor)
    if status_filter is not None:
        query = query.filter(Vendor.status == status_filter)
    return query.order_by(Vendor.legal_name).all()


@router.get("/{vendor_id}", response_model=VendorMaskedOut)
def get_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return vendor


def _load_decidable_vendor(vendor_id: int, db: Session) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    if vendor.status not in DECIDABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Vendor is in status '{vendor.status.value}' and cannot be decided from here",
        )
    return vendor


def _unverified_mandatory_docs(vendor_id: int, db: Session) -> list[str]:
    docs_by_type = {
        d.doc_type: d for d in db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor_id).all()
    }
    return [
        dt.value
        for dt in MANDATORY_DOC_TYPES
        if dt not in docs_by_type or docs_by_type[dt].status != DocumentStatus.VERIFIED
    ]


@router.post("/{vendor_id}/approve", response_model=VendorMaskedOut)
def approve_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Spec §3.3 point 5 / §3.3 point 6: approval activates the vendor and
    is what makes item/asset/service mapping possible next. User-directed
    hard gate: every mandatory document must already be Verified -- there is
    no path to Active with an unverified or missing mandatory document."""

    vendor = _load_decidable_vendor(vendor_id, db)
    missing = _unverified_mandatory_docs(vendor_id, db)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot approve: mandatory document(s) not yet verified: {', '.join(missing)}",
        )

    set_status(db, vendor, VendorStatus.ACTIVE, user.id, "Approved")
    invite_newly_active_vendor(vendor, db)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/reject", response_model=VendorMaskedOut)
def reject_vendor(
    vendor_id: int,
    payload: VendorRejection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Rejecting a still-pending application goes straight into the
    Blacklisted flow (2026-10-24, user-directed) -- no separate REJECTED
    status exists anymore, since spec 3.4 itself treats "Rejected /
    Blacklisted" as one outcome and nothing here ever gave them different
    real-world effect. The route/action is still named "reject" (the right
    verb for this stage -- you're declining an application, not barring an
    existing vendor), it just lands on the same terminal status, now
    reachable back to Active via the usual Category-Manager reinstate flow."""

    vendor = _load_decidable_vendor(vendor_id, db)
    set_status(db, vendor, VendorStatus.BLACKLISTED, user.id, payload.reason)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/request-info", response_model=VendorMaskedOut)
def request_info(
    vendor_id: int,
    payload: VendorInfoRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """User-directed: this is the path taken instead of outright rejection
    when a mandatory document is rejected but the vendor should get a
    chance to re-submit -- the note explains what's needed and why,
    same requirement as an outright rejection's reason. Also usable on an
    Active or Suspended vendor (2026-09-30) as a lighter alternative to
    Suspend/straight reinstatement -- uploading a document while Info
    Requested already routes back to Pending Verification regardless of
    what the vendor's status was before."""

    vendor = _load_vendor(vendor_id, db)
    if vendor.status not in INFO_REQUESTABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Vendor is in status '{vendor.status.value}' and info can't be requested from here")
    set_status(db, vendor, VendorStatus.INFO_REQUESTED, user.id, payload.note)
    db.commit()
    db.refresh(vendor)
    return vendor


# ---- Expedited Registration Review (spec §6.7/§12.3) -- ungoverned,
# 2026-10-22 (user-directed, reversing the governed version built earlier
# the same day). Reasoning: the flag has no actual power -- it never lets a
# vendor bid or skip KYC, it only sorts/labels an already-existing "Verify
# KYC" task that Category Manager has to act on regardless (the real
# gatekeeping is that normal vendor-approval decision, already governed on
# its own). Requiring a *separate* governed decision before a label even
# shows up was pure friction with no matching risk -- Category Manager
# would have had to approve "is this urgent" and then separately go approve
# the vendor itself. Dropped the self-attest/outstanding-count/escalation
# machinery entirely along with it: once there's no decision step, there's
# nothing left to self-attest up to a cap of, or escalate past it. Same
# idea as Manual Invite before it was governed -- a direct, immediate
# action with a mandatory reason, visible as an actioned fact, not a
# pending request.

# A tender that's done (one way or another) can't justify fresh urgency.
CLOSED_TENDER_STATUSES = {TenderStatus.WITHDRAWN, TenderStatus.NO_AWARD, TenderStatus.AWARDED}


@router.post("/{vendor_id}/expedited-review", status_code=status.HTTP_204_NO_CONTENT)
def request_expedited_review(
    vendor_id: int,
    payload: ExpeditedReviewRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*EXPEDITE_REQUESTERS)),
):
    """Flags a still-pending vendor's review as urgent against a tender
    deadline -- applies immediately, no approval step. Never grants any
    vendor-decision power (VENDOR_DECISION_ROLES stays System-Admin-only
    throughout); this only ever changes where/how the vendor shows up on
    the existing, already-governed review queue."""

    vendor = db.get(Vendor, vendor_id)
    if vendor is None or vendor.status not in DECIDABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a vendor pending verification or info-requested can have its review expedited")
    tender = db.get(Tender, payload.tender_id)
    if tender is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender not found")
    if tender.status in CLOSED_TENDER_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is '{tender.status.value}' -- it can't justify expediting a vendor's review")

    vendor.expedited_review_tender_id = tender.id
    vendor.expedited_review_requested_at = datetime.now(timezone.utc)
    record(
        db, "vendor.expedited_review_flagged", "vendor", vendor.id, actor=user, entity_label=vendor.legal_name,
        facility_id=tender.facility_id, reason=payload.justification,
        meta={"tender_id": tender.id},
    )
    db.commit()


# ---- Post-approval status changes (spec 3.4): suspend / reinstate / blacklist ----


def _load_vendor(vendor_id: int, db: Session) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return vendor


@router.post("/{vendor_id}/suspend", response_model=VendorMaskedOut)
def suspend_vendor(
    vendor_id: int,
    payload: VendorRejection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Temporarily blocks an Active vendor (compliance lapse, poor
    performance). A suspended vendor can't bid, be mapped or be invited;
    history and existing mappings are kept. Always carries a reason."""

    vendor = _load_vendor(vendor_id, db)
    if vendor.status != VendorStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Only an Active vendor can be suspended (this one is '{vendor.status.value}')")
    set_status(db, vendor, VendorStatus.SUSPENDED, user.id, payload.reason)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/reinstate", response_model=VendorMaskedOut)
def reinstate_vendor(
    vendor_id: int,
    payload: VendorReinstatement,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Suspended -> Active, or Blacklisted -> Active (or Info Requested).

    A blacklisted vendor is reinstated by System Admin (the only vendor-
    decision role now), and only with an explicit reason, which is written to
    the vendor's status history. If its mandatory documents aren't all
    verified it lands on Info Requested instead of Active, so it can log in
    and upload them. A suspension can be lifted by the usual decision roles."""

    vendor = _load_vendor(vendor_id, db)
    if vendor.status == VendorStatus.BLACKLISTED:
        if not (payload.reason and len(payload.reason.strip()) >= 10):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An explicit reason (at least 10 characters) is required to reinstate a blacklisted vendor",
            )
        # Real bug, found 2026-10-24 (same day the Reject button started
        # landing here): this path used to assume "blacklisted" only ever
        # meant "was once a properly-verified Active vendor, gone bad" --
        # true before Reject merged into Blacklist, not true anymore. A
        # vendor rejected straight from Pending Verification has never
        # cleared this gate at all; without it, reinstate would skip
        # approve_vendor()'s own mandatory-document check entirely and land
        # someone with zero verified documents on Active. A blacklisted vendor
        # can't log in to fix that, though, so rather than a dead-end 409 it
        # goes to Info Requested: it can log in and upload, and the normal
        # approve flow (which re-checks the same documents) makes it Active.
        reason = payload.reason.strip()
        missing = _unverified_mandatory_docs(vendor_id, db)
        if missing:
            set_status(
                db, vendor, VendorStatus.INFO_REQUESTED, user.id,
                f"Reinstated from blacklist — {reason}. Please upload/re-submit: {', '.join(missing)}",
            )
        else:
            set_status(db, vendor, VendorStatus.ACTIVE, user.id, f"Reinstated from blacklist — {reason}")
    elif vendor.status == VendorStatus.SUSPENDED:
        # User-directed (2026-09-30): same hard gate as first approval -- if
        # the suspension involved a rejected document, reinstating needs that
        # document re-submitted and Verified first, not just "resubmitted".
        missing = _unverified_mandatory_docs(vendor_id, db)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot reinstate: mandatory document(s) not yet verified: {', '.join(missing)}",
            )
        set_status(db, vendor, VendorStatus.ACTIVE, user.id, (payload.reason or "").strip() or "Reinstated")
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Only a Suspended or Blacklisted vendor can be reinstated (this one is '{vendor.status.value}')")
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/blacklist", response_model=VendorMaskedOut)
def blacklist_vendor(
    vendor_id: int,
    payload: VendorRejection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Bars an Active or Suspended vendor (spec 3.4 "Rejected / Blacklisted"):
    they can no longer log in, bid, be mapped or be invited. The way back is
    reinstate (System Admin, with an explicit reason)."""

    vendor = _load_vendor(vendor_id, db)
    if vendor.status not in (VendorStatus.ACTIVE, VendorStatus.SUSPENDED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Only an Active or Suspended vendor can be blacklisted (this one is '{vendor.status.value}')")
    set_status(db, vendor, VendorStatus.BLACKLISTED, user.id, payload.reason)
    db.commit()
    db.refresh(vendor)
    return vendor


# Bug report, 2026-10-14: document uploads/replacements/deletions/verify/
# reject decisions were already recorded faithfully in the audit log --
# the vendor profile's "Status History" just never read them, only
# VendorStatusHistory's own status-transition rows. "Viewed" is
# deliberately left out: it's an access log entry, not a change.
DOCUMENT_HISTORY_ACTIONS = (
    "vendor.document_uploaded",
    "vendor.documents_submitted",
    "vendor.document_deleted",
    "vendor.document_verified",
    "vendor.document_rejected",
)


def _document_history_label(row: AuditLog) -> str:
    meta = row.meta or {}
    doc = meta.get("document", "a document")
    if row.action == "vendor.document_uploaded":
        file = meta.get("file")
        return f"Document uploaded — {doc}" + (f" ({file})" if file else "")
    if row.action == "vendor.documents_submitted":
        docs = meta.get("documents") or []
        return "Documents submitted" + (f": {', '.join(docs)}" if docs else "")
    if row.action == "vendor.document_deleted":
        return f"Document removed — {doc}"
    if row.action == "vendor.document_verified":
        return f"Document verified — {doc}"
    if row.action == "vendor.document_rejected":
        return f"Document rejected — {doc}"
    return row.action


@router.get("/{vendor_id}/status-history", response_model=list[VendorHistoryEntryOut])
def vendor_status_history(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    _load_vendor(vendor_id, db)
    status_rows = db.query(VendorStatusHistory).filter(VendorStatusHistory.vendor_id == vendor_id).all()
    doc_rows = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "vendor", AuditLog.entity_id == vendor_id, AuditLog.action.in_(DOCUMENT_HISTORY_ACTIONS))
        .all()
    )
    # Real bug, found 2026-10-24: this merged history never named who acted.
    # doc_rows already carry AuditLog.actor_name (copied in at write time,
    # see that model's own docstring); status_rows only ever had actor_id,
    # so one batch UserAccount lookup resolves those to the same actor_name
    # shape, not a query per row.
    status_actor_ids = {r.actor_id for r in status_rows if r.actor_id is not None}
    status_actor_names = (
        {u.id: u.full_name for u in db.query(UserAccount).filter(UserAccount.id.in_(status_actor_ids)).all()} if status_actor_ids else {}
    )
    entries = [
        VendorHistoryEntryOut(
            id=f"status-{r.id}", at=r.at, from_status=r.from_status, to_status=r.to_status, reason=r.reason,
            actor_name=status_actor_names.get(r.actor_id),
        )
        for r in status_rows
    ] + [
        VendorHistoryEntryOut(id=f"doc-{r.id}", at=r.occurred_at, label=_document_history_label(r), reason=r.reason, actor_name=r.actor_name)
        for r in doc_rows
    ]
    entries.sort(key=lambda e: e.at)
    return entries


# ---- Document review (System Admin only) ----


@router.get("/{vendor_id}/documents", response_model=list[VendorDocumentOut])
def list_vendor_documents_for_review(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    if not db.get(Vendor, vendor_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return (
        db.query(VendorDocument)
        .filter(VendorDocument.vendor_id == vendor_id, VendorDocument.status != DocumentStatus.DRAFT)
        .order_by(VendorDocument.doc_type)
        .all()
    )


@router.get("/{vendor_id}/documents/{doc_id}/download")
def download_vendor_document_for_review(
    vendor_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    doc = _load_reviewable_document(vendor_id, doc_id, db)
    record(
        db, "vendor.document_viewed", "vendor", vendor_id, actor=_user, entity_label=doc.vendor.legal_name,
        after={"document": doc_label(doc), "file": doc.original_filename},
    )
    db.commit()
    return Response(
        content=doc.content,
        media_type=doc.content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.original_filename}"'},
    )


def _load_reviewable_document(vendor_id: int, doc_id: int, db: Session) -> VendorDocument:
    doc = db.get(VendorDocument, doc_id)
    # A Draft document hasn't been submitted -- staff can't see, download, verify or reject it.
    if not doc or doc.vendor_id != vendor_id or doc.status == DocumentStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


@router.post("/{vendor_id}/documents/{doc_id}/verify", response_model=VendorDocumentOut)
def verify_vendor_document(
    vendor_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    doc = _load_reviewable_document(vendor_id, doc_id, db)
    doc.status = DocumentStatus.VERIFIED
    doc.rejection_reason = None
    doc.reviewed_by_id = user.id
    doc.reviewed_at = datetime.now(timezone.utc)
    db.flush()
    record(
        db, "vendor.document_verified", "vendor", vendor_id, actor=user, entity_label=doc.vendor.legal_name,
        before={"status": DocumentStatus.PENDING}, after={"status": DocumentStatus.VERIFIED}, meta={"document": doc_label(doc)},
    )
    notify_vendor(db, vendor_id, kind="document_verified", title="Document verified", body=f"{doc_label(doc)} has been verified.")
    reinstate_if_cleared(db, doc.vendor, user.id)
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{vendor_id}/documents/{doc_id}/reject", response_model=VendorDocumentOut)
def reject_vendor_document(
    vendor_id: int,
    doc_id: int,
    payload: VendorDocumentRejection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Rejecting a document never touches the vendor's own status by
    itself -- the reviewer separately chooses Reject Registration or
    Request Info (with a note) once they've seen which document(s) failed,
    rather than this action silently deciding that for them."""

    doc = _load_reviewable_document(vendor_id, doc_id, db)
    doc.status = DocumentStatus.REJECTED
    doc.rejection_reason = payload.reason
    doc.reviewed_by_id = user.id
    doc.reviewed_at = datetime.now(timezone.utc)
    record(
        db, "vendor.document_rejected", "vendor", vendor_id, actor=user, entity_label=doc.vendor.legal_name,
        after={"status": DocumentStatus.REJECTED}, reason=payload.reason, meta={"document": doc_label(doc)},
    )
    notify_vendor(db, vendor_id, kind="document_rejected", title="Document rejected", body=f"{doc_label(doc)} was rejected: {payload.reason.strip()}")
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{vendor_id}/reveal", response_model=VendorRevealOut)
def reveal_sensitive_field(
    vendor_id: int,
    payload: VendorRevealRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Shows one masked identifier (GSTIN, PAN, bank account...) after the
    staff member re-enters their own password. Wrong password -> 403 (not
    401, which the UI treats as an expired session)."""

    vendor = _load_vendor(vendor_id, db)
    if not verify_password(payload.password, user.hashed_password):
        record(db, "vendor.reveal_failed", "vendor", vendor.id, actor=user, entity_label=vendor.legal_name, meta={"field": payload.field})
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Incorrect password")
    record(db, "vendor.sensitive_revealed", "vendor", vendor.id, actor=user, entity_label=vendor.legal_name, meta={"field": payload.field})
    db.commit()
    return VendorRevealOut(field=payload.field, value=getattr(vendor, payload.field))


@router.get("/{vendor_id}/document-requirements", response_model=list[ItemRequirementOut])
def vendor_document_requirements(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """What this vendor still owes per item, so the reviewer can see which
    requirement a newly uploaded document answers and who can bid on what."""
    return to_out(vendor_requirements(db, _load_vendor(vendor_id, db)))
