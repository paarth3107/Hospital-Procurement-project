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
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export interface FileTypeOptions {
  allowSpreadsheets?: boolean; // vendor sample catalogue only
  allowOffice?: boolean; // tender/bid attachments only (DOCX + XLSX)
}

export function fileTypeError(file: File, opts: FileTypeOptions = {}): string | null {
  const allowed = new Set(BASE_CONTENT_TYPES);
  if (opts.allowSpreadsheets) for (const t of SPREADSHEET_CONTENT_TYPES) allowed.add(t);
  if (opts.allowOffice) for (const t of OFFICE_CONTENT_TYPES) allowed.add(t);
  if (!allowed.has(file.type)) {
    const list = opts.allowOffice ? "PDF, JPG, PNG, DOCX or XLSX" : opts.allowSpreadsheets ? "PDF, JPG, PNG, XLSX, XLS or CSV" : "PDF, JPG or PNG";
    return `"${file.name}" isn't an accepted file type — ${list} only.`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_FILE_SIZE_BYTES) return `"${file.name}" is larger than the 2MB limit.`;
  return null;
}
