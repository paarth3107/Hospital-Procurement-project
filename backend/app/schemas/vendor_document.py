from datetime import datetime

from pydantic import BaseModel, field_validator

from app.models.vendor import DocumentStatus, VendorDocType


class VendorDocumentOut(BaseModel):
    id: int
    vendor_id: int
    doc_type: VendorDocType
    original_filename: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    rejection_reason: str | None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class VendorDocumentRejection(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A reason is required")
        return v.strip()
