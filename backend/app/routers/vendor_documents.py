from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.vendor import DocumentStatus, Vendor, VendorDocType, VendorDocument, VendorStatus
from app.schemas.vendor_document import VendorDocumentOut
from app.security import get_current_vendor
from app.services import document_store
from app.schemas.vendor_document import ItemRequirementOut
from app.services.audit import record
from app.services.document_requirements import to_out, vendor_requirements
from app.services.vendor_status import set_status

router = APIRouter(prefix="/api/v1/vendor-portal/documents", tags=["vendor-documents"])


@router.get("/requirements", response_model=list[ItemRequirementOut])
def my_document_requirements(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Per item the vendor holds (through a category or an item request): which
    required documents are missing, awaiting verification, rejected, expired or
    verified. This is what tells a vendor a newly added requirement exists."""
    return to_out(vendor_requirements(db, vendor))


@router.get("", response_model=list[VendorDocumentOut])
def list_my_documents(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    return db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor.id).order_by(VendorDocument.doc_type).all()


@router.post("", response_model=VendorDocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    doc_type: VendorDocType = Form(...),
    custom_label: str | None = Form(None),
    file: UploadFile = File(...),
    valid_till: date | None = Form(None),
    for_requirement: bool = Form(False),
    vendor: Vendor = Depends(get_current_vendor),
    db: Session = Depends(get_db),
):
    """One row per (vendor, doc_type) -- uploading again replaces the
    previous file, since a changed file needs a fresh review rather than
    inheriting the old one's verified/rejected status.

    Drafted unless it's clearly meant for staff right now (2026-09-30):
    responding to an Info Requested note, or `for_requirement` -- set by the
    Category Declaration tab when this upload is satisfying a specific
    category/item's document requirement as part of that request. The
    general Company Profile vault leaves for_requirement unset, so it stays
    a Draft until "Submit documents"."""

    label = (custom_label or "").strip()
    if doc_type == VendorDocType.OTHER and not label:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Say what this document is (custom_label)")
    if doc_type != VendorDocType.OTHER:
        label = ""
    content = await file.read()
    immediate = for_requirement or vendor.status == VendorStatus.INFO_REQUESTED
    doc = store_document(db, vendor.id, doc_type, file.filename, file.content_type, content, valid_till, label, draft=not immediate)
    record(
        db, "vendor.document_uploaded", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name,
        after={"status": doc.status},
        meta={"document": label or doc_type.value.replace("_", " "), "file": file.filename, "valid_till": valid_till},
    )
    # Spec 3.3 step 4: a vendor answering an "Info Requested" goes back into
    # the admin's Pending Verification queue, so the reply shows up as work.
    if vendor.status == VendorStatus.INFO_REQUESTED:
        what = label or doc_type.value.replace("_", " ")
        set_status(db, vendor, VendorStatus.PENDING_VERIFICATION, None, f"Vendor responded to the information request (uploaded: {what})", actor=vendor)
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/submit", response_model=list[VendorDocumentOut])
def submit_documents(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Promotes every Draft document in the vendor's vault to Pending in one
    shot -- this is the moment they actually reach the category manager."""

    drafts = db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor.id, VendorDocument.status == DocumentStatus.DRAFT).all()
    if not drafts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No draft documents to submit")
    for d in drafts:
        d.status = DocumentStatus.PENDING
    record(
        db, "vendor.documents_submitted", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name,
        meta={"documents": [d.custom_label or d.doc_type.value.replace("_", " ") for d in drafts]},
    )
    db.commit()
    for d in drafts:
        db.refresh(d)
    return drafts


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_document(doc_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    """Lets the vendor remove a mistaken attachment (wrong file, and they
    don't have the right one on hand yet) instead of being stuck with it
    until they can replace it. A document staff has already Verified can't
    be pulled out from under an approved decision this way."""

    doc = db.get(VendorDocument, doc_id)
    if not doc or doc.vendor_id != vendor.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if doc.status == DocumentStatus.VERIFIED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A Verified document can't be deleted -- replace it instead")
    label = doc.custom_label or doc.doc_type.value.replace("_", " ")
    db.delete(doc)
    record(db, "vendor.document_deleted", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name, meta={"document": label})
    db.commit()


def store_document(
    db: Session,
    vendor_id: int,
    doc_type: VendorDocType,
    filename: str,
    content_type: str,
    content: bytes,
    valid_till: date | None = None,
    custom_label: str = "",
    draft: bool = False,
) -> VendorDocument:
    """Validate + scan + upsert one document row, without committing, so
    registration can store several files atomically with the vendor row.

    `draft` (2026-09-30): registration and anything responding to a specific
    ask (an Info Requested note, a category/item document requirement) pass
    draft=False -- the document is meant for staff right away. The Company
    Profile document vault's general upload/replace passes draft=True: it
    stays invisible to staff until the vendor explicitly submits it."""

    try:
        document_store.validate(content_type, len(content), allow_spreadsheets=doc_type == VendorDocType.SAMPLE_CATALOG)
    except document_store.DocumentValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{doc_type.value}: {e}")
    document_store.scan(content)
    new_status = DocumentStatus.DRAFT if draft else DocumentStatus.PENDING

    existing = (
        db.query(VendorDocument)
        .filter(
            VendorDocument.vendor_id == vendor_id,
            VendorDocument.doc_type == doc_type,
            func.lower(VendorDocument.custom_label) == custom_label.lower(),
        )
        .first()
    )
    if existing:
        existing.original_filename = filename
        existing.content_type = content_type
        existing.size_bytes = len(content)
        existing.content = content
        existing.status = new_status
        existing.rejection_reason = None
        existing.reviewed_by_id = None
        existing.reviewed_at = None
        existing.valid_till = valid_till
        return existing
    doc = VendorDocument(
        vendor_id=vendor_id,
        doc_type=doc_type,
        custom_label=custom_label,
        original_filename=filename,
        content_type=content_type,
        size_bytes=len(content),
        content=content,
        valid_till=valid_till,
        status=new_status,
    )
    db.add(doc)
    return doc


@router.get("/{doc_id}/download")
def download_my_document(doc_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    doc = db.get(VendorDocument, doc_id)
    if not doc or doc.vendor_id != vendor.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return Response(
        content=doc.content,
        media_type=doc.content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.original_filename}"'},
    )
