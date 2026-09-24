from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.database import get_db
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
    VendorCreate,
    VendorInfoRequest,
    VendorLookupOut,
    VendorOut,
    VendorReinstatement,
    VendorRejection,
    VendorStatusHistoryOut,
)
from app.schemas.vendor_document import VendorDocumentOut, VendorDocumentRejection
from app.routers.vendor_documents import store_document
from app.security import get_current_user, hash_password, require_role
from app.services.vendor_status import set_status

router = APIRouter(prefix="/api/v1/vendors", tags=["vendors"])

# Category Manager now shares vendor-decision access with Procurement Admin
# (user-directed change: document review/decisioning moves to Category
# Manager). System Admin was already missing from approve/reject/request-info
# despite having list/get access -- folded into one set so that gap doesn't
# recur.
VENDOR_DECISION_ROLES = (Role.PROCUREMENT_ADMIN, Role.CATEGORY_MANAGER, Role.SYSTEM_ADMIN)

# Spec §3.4: only these two statuses are legal starting points for an
# admin decision. An already-Active or already-Rejected vendor can't be
# re-decided through this endpoint (a status change from there is a
# different workflow, e.g. suspension — not built in this pass).
DECIDABLE_STATUSES = {VendorStatus.PENDING_VERIFICATION, VendorStatus.INFO_REQUESTED}


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
async def register_vendor(
    legal_name: str = Form(...),
    gstin: str = Form(...),
    pan: str = Form(...),
    contact_person: str = Form(...),
    email: str = Form(...),
    phone: str = Form(...),
    password: str = Form(...),
    gst_certificate: UploadFile = File(...),
    pan_card: UploadFile = File(...),
    incorporation_certificate: UploadFile = File(...),
    bank_proof: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    """Spec §3.3 registration workflow. Deliberately the *only* vendor
    creation path in this system — the Open Tender public landing page and
    the "invite a prospective vendor" flow both route here too (CLAUDE.md
    PROJECT OVERRIDE: no lightweight/guest variant that skips this).

    Multipart: the vendor row and every mandatory document (GST certificate,
    PAN card, incorporation certificate; bank proof optional) are saved in
    one transaction, so a registration can never exist without its mandatory
    documents. Enforced here, not just by the form."""

    try:
        payload = VendorCreate(
            legal_name=legal_name, gstin=gstin, pan=pan, contact_person=contact_person,
            email=email, phone=phone, password=password,
        )
    except ValidationError as e:
        msg = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors())
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=msg)

    # Spec §3.5 duplicate check + §6.8.2 point 3 (Open Tender self-
    # registration matches an existing profile instead of duplicating).
    # GSTIN, PAN, email and phone must each be unique to one vendor.
    for column, value, label in (
        (Vendor.gstin, payload.gstin, "GSTIN"),
        (Vendor.pan, payload.pan, "PAN"),
        (Vendor.email, payload.email, "email address"),
        (Vendor.phone, payload.phone, "phone number"),
    ):
        existing = db.query(Vendor).filter(column == value).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A vendor with this {label} is already registered (status: {existing.status.value})",
            )

    files = {
        VendorDocType.GST_CERTIFICATE: gst_certificate,
        VendorDocType.PAN_CARD: pan_card,
        VendorDocType.INCORPORATION_CERTIFICATE: incorporation_certificate,
    }
    if bank_proof is not None and bank_proof.filename:
        files[VendorDocType.BANK_PROOF] = bank_proof

    vendor = Vendor(
        legal_name=payload.legal_name,
        gstin=payload.gstin,
        pan=payload.pan,
        contact_person=payload.contact_person,
        email=payload.email,
        phone=payload.phone,
        status=VendorStatus.PENDING_VERIFICATION,
        hashed_password=hash_password(payload.password),
    )
    db.add(vendor)
    db.flush()
    db.add(VendorStatusHistory(vendor_id=vendor.id, from_status=None, to_status=VendorStatus.PENDING_VERIFICATION, reason="Registered"))
    for doc_type, upload in files.items():
        store_document(db, vendor.id, doc_type, upload.filename, upload.content_type, await upload.read())
    db.commit()
    db.refresh(vendor)
    return vendor


@router.get("", response_model=list[VendorOut])
def list_vendors(
    status_filter: VendorStatus | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES, Role.PROCUREMENT_OFFICER)),
):
    query = db.query(Vendor)
    if status_filter is not None:
        query = query.filter(Vendor.status == status_filter)
    return query.order_by(Vendor.created_at.desc()).all()


@router.get("/lookup", response_model=list[VendorLookupOut])
def lookup_vendors(
    status_filter: VendorStatus | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    """Backs the vendor picker on Vendor Mapping / Vendor Rating — any staff
    member needs to find a vendor by name there, not just Procurement Admin,
    but the full `GET /vendors` listing (GSTIN/PAN/contact) stays admin-only.
    No filter by default; callers creating a new mapping pass
    `status_filter=active` (CLAUDE.md PROJECT OVERRIDE: only Active vendors
    are ever eligible for mapping/bidding), while callers resolving an
    existing mapping/rating's vendor name want every status."""

    query = db.query(Vendor)
    if status_filter is not None:
        query = query.filter(Vendor.status == status_filter)
    return query.order_by(Vendor.legal_name).all()


@router.get("/{vendor_id}", response_model=VendorOut)
def get_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES, Role.PROCUREMENT_OFFICER)),
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


@router.post("/{vendor_id}/approve", response_model=VendorOut)
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
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/reject", response_model=VendorOut)
def reject_vendor(
    vendor_id: int,
    payload: VendorRejection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    vendor = _load_decidable_vendor(vendor_id, db)
    set_status(db, vendor, VendorStatus.REJECTED, user.id, payload.reason)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/request-info", response_model=VendorOut)
def request_info(
    vendor_id: int,
    payload: VendorInfoRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """User-directed: this is the path taken instead of outright rejection
    when a mandatory document is rejected but the vendor should get a
    chance to re-submit -- the note explains what's needed and why,
    same requirement as an outright rejection's reason."""

    vendor = _load_decidable_vendor(vendor_id, db)
    set_status(db, vendor, VendorStatus.INFO_REQUESTED, user.id, payload.note)
    db.commit()
    db.refresh(vendor)
    return vendor


# ---- Post-approval status changes (spec 3.4): suspend / reinstate / blacklist ----


def _load_vendor(vendor_id: int, db: Session) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return vendor


@router.post("/{vendor_id}/suspend", response_model=VendorOut)
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


# The Procurement Officer is in charge of bringing a blacklisted vendor back
# (System Admin as the usual catch-all); every other decision role handles
# ordinary suspensions.
BLACKLIST_REINSTATERS = (Role.PROCUREMENT_OFFICER, Role.SYSTEM_ADMIN)


@router.post("/{vendor_id}/reinstate", response_model=VendorOut)
def reinstate_vendor(
    vendor_id: int,
    payload: VendorReinstatement,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES, Role.PROCUREMENT_OFFICER)),
):
    """Suspended -> Active, or Blacklisted -> Active.

    A blacklisted vendor can only be reinstated by the Procurement Officer
    (or System Admin), and only with an explicit reason, which is written to
    the vendor's status history. A suspension can be lifted by the usual
    decision roles."""

    vendor = _load_vendor(vendor_id, db)
    if vendor.status == VendorStatus.BLACKLISTED:
        if user.role not in BLACKLIST_REINSTATERS:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the Procurement Officer can reinstate a blacklisted vendor")
        if not (payload.reason and payload.reason.strip()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An explicit reason is required to reinstate a blacklisted vendor")
        set_status(db, vendor, VendorStatus.ACTIVE, user.id, f"Reinstated from blacklist — {payload.reason.strip()}")
    elif vendor.status == VendorStatus.SUSPENDED:
        if user.role == Role.PROCUREMENT_OFFICER:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="A suspension is lifted by Procurement Admin or Category Manager")
        set_status(db, vendor, VendorStatus.ACTIVE, user.id, (payload.reason or "").strip() or "Reinstated")
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Only a Suspended or Blacklisted vendor can be reinstated (this one is '{vendor.status.value}')")
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/blacklist", response_model=VendorOut)
def blacklist_vendor(
    vendor_id: int,
    payload: VendorRejection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES)),
):
    """Bars an Active or Suspended vendor (spec 3.4 "Rejected / Blacklisted"):
    they can no longer log in, bid, be mapped or be invited. The way back is
    reinstate (Procurement Officer, with an explicit reason)."""

    vendor = _load_vendor(vendor_id, db)
    if vendor.status not in (VendorStatus.ACTIVE, VendorStatus.SUSPENDED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Only an Active or Suspended vendor can be blacklisted (this one is '{vendor.status.value}')")
    set_status(db, vendor, VendorStatus.BLACKLISTED, user.id, payload.reason)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.get("/{vendor_id}/status-history", response_model=list[VendorStatusHistoryOut])
def vendor_status_history(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*VENDOR_DECISION_ROLES, Role.PROCUREMENT_OFFICER)),
):
    _load_vendor(vendor_id, db)
    rows = db.query(VendorStatusHistory).filter(VendorStatusHistory.vendor_id == vendor_id).order_by(VendorStatusHistory.at).all()
    return rows


# ---- Document review (Category Manager / Procurement Admin / System Admin) ----


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
        .filter(VendorDocument.vendor_id == vendor_id)
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
    doc = db.get(VendorDocument, doc_id)
    if not doc or doc.vendor_id != vendor_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return Response(
        content=doc.content,
        media_type=doc.content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.original_filename}"'},
    )


def _load_reviewable_document(vendor_id: int, doc_id: int, db: Session) -> VendorDocument:
    doc = db.get(VendorDocument, doc_id)
    if not doc or doc.vendor_id != vendor_id:
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
    db.commit()
    db.refresh(doc)
    return doc
