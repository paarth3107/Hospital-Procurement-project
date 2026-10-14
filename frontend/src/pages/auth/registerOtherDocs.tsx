import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { api, uploadWithProgress } from "../../lib/api";
import { fileTypeError } from "../../lib/fileValidation";
import { UploadProgress } from "../../components/CircularProgress";
import type { VendorDocument } from "../../lib/types";

// User-directed rewrite (2026-10-13): each "other" document now uploads
// itself the moment both a name and a file are present, right here, with
// its own progress ring -- same reasoning as registerDocuments.tsx. Needs
// `vendorId`/`registrationToken` directly (the draft vendor created by
// RegisterPage.tsx's Continue) rather than just staging a File for the old
// one-giant-request submit.
export interface OtherDocsHandle {
  addRow: () => void;
  reset: () => void;
}

interface RowState {
  uploading: boolean;
  progress: number;
  error: string | null;
  doc: VendorDocument | null;
}
const EMPTY_ROW: RowState = { uploading: false, progress: 0, error: null, doc: null };

export const OtherDocsSection = forwardRef<OtherDocsHandle, { vendorId: number | null; registrationToken: string | null }>(({ vendorId, registrationToken }, ref) => {
  const [rows, setRows] = useState<number[]>([]);
  const [rowState, setRowState] = useState<Record<number, RowState>>({});
  const nextId = useRef(0);
  const labelRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useImperativeHandle(ref, () => ({
    addRow() {
      setRows((r) => [...r, nextId.current++]);
    },
    reset() {
      setRows([]);
      setRowState({});
      nextId.current = 0;
    },
  }));

  const removeRow = async (id: number) => {
    const existing = rowState[id]?.doc;
    setRows((r) => r.filter((x) => x !== id));
    setRowState((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // The file's already on the server -- take it back off rather than
    // leaving an orphaned "other" document attached to this registration.
    if (existing && vendorId && registrationToken) {
      try {
        await api(`/vendors/${vendorId}/documents/${existing.id}?registration_token=${encodeURIComponent(registrationToken)}`, { method: "DELETE" });
      } catch {
        // best-effort -- it's gone from the UI either way, and a stray
        // "other" document nobody asked about doesn't block anything
      }
    }
  };

  const pickFile = async (id: number, file: File | undefined) => {
    if (!file || !vendorId || !registrationToken) return;
    const label = labelRefs.current[id]?.value.trim();
    if (!label) {
      setRowState((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_ROW), error: "Name this document first." } }));
      return;
    }
    const typeErr = fileTypeError(file);
    if (typeErr) {
      setRowState((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_ROW), error: typeErr } }));
      return;
    }
    setRowState((prev) => ({ ...prev, [id]: { uploading: true, progress: 0, error: null, doc: prev[id]?.doc ?? null } }));
    const fd = new FormData();
    fd.append("registration_token", registrationToken);
    fd.append("doc_type", "other");
    fd.append("custom_label", label);
    fd.append("file", file);
    try {
      const doc = await uploadWithProgress<VendorDocument>(`/vendors/${vendorId}/documents`, fd, (p) => setRowState((prev) => ({ ...prev, [id]: { ...prev[id], progress: p } })));
      setRowState((prev) => ({ ...prev, [id]: { uploading: false, progress: 1, error: null, doc } }));
    } catch (err) {
      setRowState((prev) => ({ ...prev, [id]: { uploading: false, progress: 0, error: err instanceof Error ? err.message : String(err), doc: prev[id]?.doc ?? null } }));
    }
  };

  return (
    <div className="d-flex flex-col gap-10px">
      {rows.map((id) => {
        const state = rowState[id] ?? EMPTY_ROW;
        return (
          <div className="ep-pane ep-pane-pad d-flex gap-10px items-end flex-wrap" key={id}>
            <div className="ep-field flex-2 minw-220px">
              <div className="ep-k">
                Document name
                <span className="required-mark">*</span>
              </div>
              <input
                className="input"
                placeholder="e.g. CE marking certificate"
                ref={(el) => {
                  labelRefs.current[id] = el;
                }}
                disabled={state.uploading}
              />
            </div>
            <div className="ep-field flex-2 minw-220px">
              <div className="ep-k">
                File
                <span className="required-mark">*</span>
              </div>
              {state.uploading ? (
                <div className="input d-flex items-center">
                  <UploadProgress value={state.progress} />
                </div>
              ) : (
                <input className="input" type="file" onChange={(e) => pickFile(id, e.target.files?.[0])} />
              )}
              {state.error && <div className="field-error">{state.error}</div>}
              {state.doc && <div className="ep-sub mt-4px">{state.doc.original_filename} uploaded</div>}
            </div>
            <button type="button" className="ep-b" disabled={state.uploading} onClick={() => removeRow(id)}>
              Remove
            </button>
          </div>
        );
      })}
    </div>
  );
});
