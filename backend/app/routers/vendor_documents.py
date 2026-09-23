from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.vendor import DocumentStatus, Vendor, VendorDocType, VendorDocument
from app.schemas.vendor_document import VendorDocumentOut
from app.security import get_current_vendor
from app.services import document_store

router = APIRouter(prefix="/api/v1/vendor-portal/documents", tags=["vendor-documents"])


@router.get("", response_model=list[VendorDocumentOut])
def list_my_documents(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    return db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor.id).order_by(VendorDocument.doc_type).all()


@router.post("", response_model=VendorDocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    doc_type: VendorDocType = Form(...),
    file: UploadFile = File(...),
    vendor: Vendor = Depends(get_current_vendor),
    db: Session = Depends(get_db),
):
    """One row per (vendor, doc_type) -- uploading again replaces the
    previous file and resets it to Pending, since a changed file needs a
    fresh review rather than inheriting the old one's verified/rejected
    status."""

    content = await file.read()
    try:
        document_store.validate(file.content_type, len(content))
    except document_store.DocumentValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    document_store.scan(content)

    existing = (
        db.query(VendorDocument)
        .filter(VendorDocument.vendor_id == vendor.id, VendorDocument.doc_type == doc_type)
        .first()
    )
    if existing:
        existing.original_filename = file.filename
        existing.content_type = file.content_type
        existing.size_bytes = len(content)
        existing.content = content
        existing.status = DocumentStatus.PENDING
        existing.rejection_reason = None
        existing.reviewed_by_id = None
        existing.reviewed_at = None
        doc = existing
    else:
        doc = VendorDocument(
            vendor_id=vendor.id,
            doc_type=doc_type,
            original_filename=file.filename,
            content_type=file.content_type,
            size_bytes=len(content),
            content=content,
        )
        db.add(doc)
    db.commit()
    db.refresh(doc)
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
