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
// Works before the tender has a real id too, same as a line item's own
// attachments: uploading silently saves a draft first via ensureSaved
// (found 2026-10-14 -- this used to just show "Save as Draft first" or,
// for the Rate Contract field specifically, nothing at all).
function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function SingleDocumentField({
  tender,
  ensureSaved,
  endpoint,
  fieldPrefix,
  label,
  requiredLabel,
  onChange,
  disabled = false,
  showRequiredIfMissing = false,
}: {
  tender: Tender | null;
  // Shows (and greys out) this field even while its owning toggle is off,
  // instead of the field appearing/disappearing with it (user-directed,
  // 2026-10-16) -- Rate Contract's own agreement upload only makes sense
  // once Rate Contract is actually on.
  disabled?: boolean;
  // Only surface requiredLabel once the caller says the user has actually
  // tried to move forward (user-directed, 2026-10-16) -- it used to show
  // the moment the page loaded, reading like a standing validation error
  // for something nobody has attempted yet.
  showRequiredIfMissing?: boolean;
  // The "no save-first wall" pattern LineItemsGrid's attachments already use
  // (ensureLineSaved): a brand-new tender has no id to upload against yet,
  // so silently save one instead of blocking the upload behind a separate,
  // manual Save as Draft click -- real bug, found 2026-10-14 (the Rate
  // Contract field didn't even show a hint in this state, just nothing).
  ensureSaved: () => Promise<Tender>;
  endpoint: string;
  fieldPrefix: string;
  label: string;
  requiredLabel: string;
  onChange: (updated: Tender) => void;
}) {
  const { confirmAsync, alertAsync, modalElement } = useModal();
  // Real bug, found 2026-10-13: nothing stopped a second click mid-upload,
  // and nothing showed the user anything was even happening.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const field = (t: Tender, suffix: string): unknown => (t as unknown as Record<string, unknown>)[`${fieldPrefix}_${suffix}`];

  const pickAndUpload = () => {
    if (uploading) return;
    const picker = document.createElement("input");
    picker.type = "file";
    // `.doc` (legacy Word) was listed here but was never actually accepted
    // server-side -- only `.docx` is in document_store.py's OFFICE_CONTENT_
    // TYPES; corrected alongside adding the real check below. `.xlsx` was
    // also wrongly listed here (found 2026-10-14) -- this is a T&C/rate
    // contract document, never a spreadsheet; see lib/fileValidation.ts's
    // allowWord.
    picker.accept = ".pdf,.jpg,.jpeg,.png,.docx";
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      // Real bug, found 2026-10-13: `accept=` above is just a picker hint,
      // and nothing ever actually checked the picked file before sending
      // it -- a disallowed type/oversized file only got rejected by the
      // backend's own document_store.validate(), after the upload
      // round-trip. See lib/fileValidation.ts.
      const typeErr = fileTypeError(file, { allowWord: true });
      if (typeErr) {
        await alertAsync(typeErr);
        return;
      }
      setUploading(true);
      setUploadProgress(0);
      try {
        const t = tender ?? (await ensureSaved());
        const fd = new FormData();
        fd.append("file", file);
        const updated = await uploadWithProgress<Tender>(`/tenders/${t.id}/${endpoint}`, fd, setUploadProgress);
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

  const filename = tender ? (field(tender, "filename") as string | null) : null;

  return (
    <>
      {filename ? (
        <div className="d-flex items-center gap-10px">
          <span className="fw-600 doc-filename" title={filename}>
            {filename}
          </span>
          <span className="ep-sub nowrap">{fmtSize(field(tender!, "size") as number | null)}</span>
          <button type="button" className="ep-b" disabled={uploading || disabled} onClick={download}>
            Download
          </button>
          <button type="button" className="ep-b" disabled={uploading || disabled} onClick={pickAndUpload}>
            {uploading ? <UploadProgress value={uploadProgress} /> : "Replace"}
          </button>
          <button type="button" className="ep-b" disabled={uploading || disabled} onClick={remove}>
            Remove
          </button>
        </div>
      ) : (
        <div className="d-flex items-center gap-10px flex-wrap">
          <button type="button" className="ep-b" disabled={uploading || disabled} onClick={pickAndUpload}>
            {uploading ? <UploadProgress value={uploadProgress} /> : "Upload Document"}
          </button>
          {/* Only once the user has actually tried to move forward, and only
              while this field applies at all (its toggle, if any, is on) --
              not a standing validation error from page load. */}
          {!disabled && showRequiredIfMissing && <span className="fs-12px text-danger-700">{requiredLabel}</span>}
        </div>
      )}
      {modalElement}
    </>
  );
}
