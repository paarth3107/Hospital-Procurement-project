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
from app.services.audit import record
from app.services.vendor_status import set_status

router = APIRouter(prefix="/api/v1/vendor-portal/documents", tags=["vendor-documents"])


@router.get("", response_model=list[VendorDocumentOut])
def list_my_documents(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    return db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor.id).order_by(VendorDocument.doc_type).all()


@router.post("", response_model=VendorDocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    doc_type: VendorDocType = Form(...),
    custom_label: str | None = Form(None),
    file: UploadFile = File(...),
    valid_till: date | None = Form(None),
    vendor: Vendor = Depends(get_current_vendor),
    db: Session = Depends(get_db),
):
    """One row per (vendor, doc_type) -- uploading again replaces the
    previous file and resets it to Pending, since a changed file needs a
    fresh review rather than inheriting the old one's verified/rejected
    status."""

    label = (custom_label or "").strip()
    if doc_type == VendorDocType.OTHER and not label:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Say what this document is (custom_label)")
    if doc_type != VendorDocType.OTHER:
        label = ""
    content = await file.read()
    doc = store_document(db, vendor.id, doc_type, file.filename, file.content_type, content, valid_till, label)
    record(
        db, "vendor.document_uploaded", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name,
        after={"status": DocumentStatus.PENDING},
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


def store_document(
    db: Session,
    vendor_id: int,
    doc_type: VendorDocType,
    filename: str,
    content_type: str,
    content: bytes,
    valid_till: date | None = None,
    custom_label: str = "",
) -> VendorDocument:
    """Validate + scan + upsert one document row, without committing, so
    registration can store several files atomically with the vendor row."""

    try:
        document_store.validate(content_type, len(content), allow_spreadsheets=doc_type == VendorDocType.SAMPLE_CATALOG)
    except document_store.DocumentValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{doc_type.value}: {e}")
    document_store.scan(content)

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
        existing.status = DocumentStatus.PENDING
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
