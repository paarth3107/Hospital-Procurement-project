from datetime import date, datetime

from pydantic import BaseModel, field_validator

from app.models.vendor import DocumentStatus, VendorDocType
from app.schemas.validators import require_reason


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
        # Capped shorter than other reason fields (real bug, found 2026-10-24):
        # this one renders inline under the document's status badge, in a
        # table row -- not behind a "View reason" link like everywhere else
        # a reason is shown -- so an unbounded reason here visibly overflowed
        # the row.
        return require_reason(v, max_length=300)


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
