from datetime import date, datetime

from pydantic import BaseModel, field_validator

from app.models.vendor import DocumentStatus, VendorDocType


class VendorDocumentOut(BaseModel):
    id: int
    vendor_id: int
    doc_type: VendorDocType
    custom_label: str
    original_filename: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    rejection_reason: str | None
    uploaded_at: datetime
    valid_till: date | None
    expiry_state: str

    model_config = {"from_attributes": True}


class VendorDocumentRejection(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A reason is required")
        return v.strip()


class RequiredDocumentOut(BaseModel):
    entry: str  # catalog entry, e.g. "gst_certificate" or "other:CE marking"
    label: str
    state: str  # missing | pending | verified | rejected | expired
    doc_id: int | None
    reason: str | None


class ItemRequirementOut(BaseModel):
    product_id: int
    product_code: str
    product_name: str
    category: str
    source: str  # category | item
    mapping_state: str  # approved | pending
    summary: str  # verified | documents_needed | awaiting_verification
    documents: list[RequiredDocumentOut]
