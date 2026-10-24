// Real bug, found 2026-10-13: every upload surface in this app (vendor
// registration/document-vault documents, tender attachments, bid
// attachments) only ever set an `accept=` attribute on its file input --
// that's just a hint to the OS file picker's own filter, which a user can
// override ("All files"), and it does nothing at all for a drag-and-drop,
// which bypasses the picker entirely. Nothing ever actually checked what
// got dropped/picked, so a disallowed file type sailed straight through to
// the eventual submit/save and only got rejected by the backend at that
// point. These rules are copied directly from backend/app/services/
// document_store.py's own `validate()` -- same content-type allowlist
// (shared by ALL four upload surfaces, differing only in which extra set
// is OR'd in -- allow_spreadsheets for the vendor sample catalogue,
// allow_office for tender/bid attachments), same size limit (2MB, reduced
// from 10MB 2026-10-14, user-directed), same empty-file rejection -- read
// via a subagent dispatched to quote that file's actual code, not guessed
// at, so nothing here can accept something the backend would reject or
// reject something it would accept.
const BASE_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const SPREADSHEET_CONTENT_TYPES = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv"]);
const OFFICE_CONTENT_TYPES = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
// Terms & Conditions / Rate Contract agreement: a text document, never a
// spreadsheet -- DOCX only, unlike OFFICE_CONTENT_TYPES above which spec
// 6.4.2/8.3.2 explicitly wants XLSX for too (real bid/line-item attachments).
const WORD_CONTENT_TYPES = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export interface FileTypeOptions {
  allowSpreadsheets?: boolean; // vendor sample catalogue only
  allowOffice?: boolean; // tender/bid attachments only (DOCX + XLSX)
  allowWord?: boolean; // tender T&C / rate contract documents only (DOCX, no XLSX)
}

export function fileTypeError(file: File, opts: FileTypeOptions = {}): string | null {
  const allowed = new Set(BASE_CONTENT_TYPES);
  if (opts.allowSpreadsheets) for (const t of SPREADSHEET_CONTENT_TYPES) allowed.add(t);
  if (opts.allowOffice) for (const t of OFFICE_CONTENT_TYPES) allowed.add(t);
  if (opts.allowWord) for (const t of WORD_CONTENT_TYPES) allowed.add(t);
  if (!allowed.has(file.type)) {
    const list = opts.allowOffice ? "PDF, JPG, PNG, DOCX or XLSX" : opts.allowWord ? "PDF, JPG, PNG or DOCX" : opts.allowSpreadsheets ? "PDF, JPG, PNG, XLSX, XLS or CSV" : "PDF, JPG or PNG";
    return `"${file.name}" isn't an accepted file type — ${list} only.`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  // Real bug, found 2026-10-24: this message named the limit but never the
  // file's own size, so a file whose size Windows Explorer rounds to display
  // as exactly "2.00 MB" (anything up to ~2.1MB on screen, since Explorer
  // rounds to 2 decimal places off a binary MB) looked identical to the
  // limit itself with no way to tell why it was rejected. The exact byte
  // count is unambiguous even right at that rounding edge, so it's included
  // alongside the MB figure rather than instead of it. Mirrors the
  // equivalent message in backend/app/services/document_store.py's validate().
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(2);
    return `"${file.name}" is ${mb}MB (${file.size.toLocaleString()} bytes) — over the 2MB (${MAX_FILE_SIZE_BYTES.toLocaleString()} byte) limit.`;
  }
  return null;
}
