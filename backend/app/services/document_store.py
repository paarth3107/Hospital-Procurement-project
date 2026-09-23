"""Document/DMS storage boundary (CLAUDE.md: "adapters + mocks locally, not
faked"). Today's implementation is Postgres BYTEA (VendorDocument.content) --
swapping to a real object store or DMS integration later means changing the
two functions here, not every call site that touches a document.

"Analysis" for this pass is structural only, per explicit scope decision:
type/size validation plus a malware-scan stub. No OCR/content extraction --
that would need a real vision/OCR service wired in, which hasn't been
decided on yet.
"""

ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB


class DocumentValidationError(ValueError):
    pass


def validate(content_type: str, size_bytes: int) -> None:
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise DocumentValidationError(f"Unsupported file type '{content_type}' — PDF, JPG, and PNG are accepted")
    if size_bytes == 0:
        raise DocumentValidationError("File is empty")
    if size_bytes > MAX_FILE_SIZE_BYTES:
        raise DocumentValidationError(f"File exceeds the {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB limit")


def scan(content: bytes) -> None:
    """Malware-scan stub. A real DocumentStore adapter would call an actual
    scanning engine here; this pass never received real infra for that, so
    it deliberately does nothing rather than fake a pass/fail result."""
    return
