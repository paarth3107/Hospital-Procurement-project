import { useState } from "react";
import { api, API_BASE, apiHeaders, uploadWithProgress } from "../../lib/api";
import { fileTypeError } from "../../lib/fileValidation";
import { UploadProgress } from "../../components/CircularProgress";
import { useModal } from "../../components/useModal";
import type { Tender } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/singleDocument.js -- a single-
// slot document a tender header carries, upload-replaces: Terms &
// Conditions and the Rate Contract agreement are both "exactly one
// document, uploading again replaces it" fields on Tender, differing only
// in which field/endpoint/label they use (same as the vanilla version's
// factory function -- here, just a configurable component instead).
// Usable only once the tender has a real id, same as a line item's own
// attachments.
function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function SingleDocumentField({
  tender,
  endpoint,
  fieldPrefix,
  label,
  requiredLabel,
  noTenderHint = true,
  onChange,
}: {
  tender: Tender | null;
  endpoint: string;
  fieldPrefix: string;
  label: string;
  requiredLabel: string;
  noTenderHint?: boolean;
  onChange: (updated: Tender) => void;
}) {
  const { confirmAsync, alertAsync, modalElement } = useModal();
  // Real bug, found 2026-10-13: nothing stopped a second click mid-upload,
  // and nothing showed the user anything was even happening.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const field = (t: Tender, suffix: string): unknown => (t as unknown as Record<string, unknown>)[`${fieldPrefix}_${suffix}`];

  const pickAndUpload = () => {
    if (!tender || uploading) return;
    const picker = document.createElement("input");
    picker.type = "file";
    // `.doc` (legacy Word) was listed here but was never actually accepted
    // server-side -- only `.docx` is in document_store.py's OFFICE_CONTENT_
    // TYPES; corrected alongside adding the real check below.
    picker.accept = ".pdf,.jpg,.jpeg,.png,.docx,.xlsx";
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      // Real bug, found 2026-10-13: `accept=` above is just a picker hint,
      // and nothing ever actually checked the picked file before sending
      // it -- a disallowed type/oversized file only got rejected by the
      // backend's own document_store.validate(), after the upload
      // round-trip. See lib/fileValidation.ts.
      const typeErr = fileTypeError(file, { allowOffice: true });
      if (typeErr) {
        await alertAsync(typeErr);
        return;
      }
      setUploading(true);
      setUploadProgress(0);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const updated = await uploadWithProgress<Tender>(`/tenders/${tender.id}/${endpoint}`, fd, setUploadProgress);
        onChange(updated);
      } catch (err) {
        await alertAsync(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    });
    picker.click();
  };

  const download = async () => {
    if (!tender) return;
    try {
      const res = await fetch(`${API_BASE}/tenders/${tender.id}/${endpoint}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (err) {
      await alertAsync(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    if (!tender) return;
    const ok = await confirmAsync(`Remove the ${label}?`);
    if (!ok) return;
    try {
      const updated = await api<Tender>(`/tenders/${tender.id}/${endpoint}`, { method: "DELETE" });
      onChange(updated);
    } catch (err) {
      await alertAsync(err instanceof Error ? err.message : String(err));
    }
  };

  if (!tender) {
    return (
      <>
        {!noTenderHint && <div className="hint">Save as Draft first, then upload the document.</div>}
        {modalElement}
      </>
    );
  }

  const filename = field(tender, "filename") as string | null;

  return (
    <>
      {filename ? (
        <div className="d-flex items-center gap-10px flex-wrap">
          <span className="fw-600">{filename}</span>
          <span className="ep-sub">{fmtSize(field(tender, "size") as number | null)}</span>
          <button type="button" className="ep-b" disabled={uploading} onClick={download}>
            Download
          </button>
          <button type="button" className="ep-b" disabled={uploading} onClick={pickAndUpload}>
            {uploading ? <UploadProgress value={uploadProgress} /> : "Replace"}
          </button>
          <button type="button" className="ep-b" disabled={uploading} onClick={remove}>
            Remove
          </button>
        </div>
      ) : (
        <div className="d-flex items-center gap-10px flex-wrap">
          <span className="fs-12px text-danger-700">{requiredLabel}</span>
          <button type="button" className="ep-b" disabled={uploading} onClick={pickAndUpload}>
            {uploading ? <UploadProgress value={uploadProgress} /> : "Upload document"}
          </button>
        </div>
      )}
      {modalElement}
    </>
  );
}
