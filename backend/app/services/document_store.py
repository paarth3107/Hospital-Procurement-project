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
# A sample catalogue / price list is usually a spreadsheet.
SPREADSHEET_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
}
# Spec 6.4.2 / 8.3.2: bid/line-item attachments also accept DOCX and XLSX.
OFFICE_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
# Terms & Conditions / Rate Contract agreement: a text document, never a
# spreadsheet -- DOCX only, unlike the bid/line-item OFFICE_CONTENT_TYPES
# above which spec 6.4.2/8.3.2 explicitly wants XLSX for too. Found 2026-10-14:
# these two endpoints were wrongly passing allow_office=True and accepting XLSX.
WORD_CONTENT_TYPES = {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024  # 2MB (reduced from 10MB, 2026-10-14, user-directed)


class DocumentValidationError(ValueError):
    pass


def validate(
    content_type: str, size_bytes: int, allow_spreadsheets: bool = False, allow_office: bool = False, allow_word: bool = False
) -> None:
    allowed = ALLOWED_CONTENT_TYPES | SPREADSHEET_CONTENT_TYPES if allow_spreadsheets else set(ALLOWED_CONTENT_TYPES)
    if allow_office:
        allowed |= OFFICE_CONTENT_TYPES
    if allow_word:
        allowed |= WORD_CONTENT_TYPES
    if content_type not in allowed:
        if allow_office:
            accepted = "PDF, DOCX, XLSX, JPG, and PNG"
        elif allow_word:
            accepted = "PDF, DOCX, JPG, and PNG"
        else:
            accepted = "PDF, JPG, PNG, or a spreadsheet (XLSX/CSV)" if allow_spreadsheets else "PDF, JPG, and PNG"
        raise DocumentValidationError(f"Unsupported file type '{content_type}' — {accepted} are accepted")
    if size_bytes == 0:
        raise DocumentValidationError("File is empty")
    if size_bytes > MAX_FILE_SIZE_BYTES:
        # Real bug, found 2026-10-24: this message named the limit but never the
        # file's own size, so a file whose size Windows Explorer rounds to
        # display as exactly "2.00 MB" (anything up to ~2.1MB on screen, since
        # Explorer rounds to 2 decimal places off a binary MB) looked identical
        # to the limit itself with no way to tell why it was rejected. The exact
        # byte count is unambiguous even right at that rounding edge, so it's
        # included alongside the MB figure rather than instead of it. Mirrors
        # the equivalent message in frontend/src/lib/fileValidation.ts.
        raise DocumentValidationError(
            f"File is {size_bytes / (1024 * 1024):.2f}MB ({size_bytes:,} bytes) — over the "
            f"{MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB ({MAX_FILE_SIZE_BYTES:,} byte) limit"
        )


def scan(content: bytes) -> None:
    """Malware-scan stub. A real DocumentStore adapter would call an actual
    scanning engine here; this pass never received real infra for that, so
    it deliberately does nothing rather than fake a pass/fail result."""
    return
