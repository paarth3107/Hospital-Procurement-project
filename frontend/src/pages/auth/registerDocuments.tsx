import { useRef, useState } from "react";
import { VENDOR_DOC_TYPES, acceptFor, type VendorDocTypeDef } from "../../lib/constants";
import { fileTypeError } from "../../lib/fileValidation";
import { UploadProgress } from "../../components/CircularProgress";

// User-directed rewrite (2026-10-13): every document used to just sit in
// memory as a picked `File`, bundled with everything else into ONE giant
// request only at final "Submit for verification" -- see RegisterPage.tsx's
// own note on why that was slow/unreliable with several large documents.
// Each dropzone now uploads ITS OWN file the moment it's picked/dropped,
// right here, with its own progress ring -- `onPick` (RegisterPage.tsx) is
// what actually POSTs it and reports progress back into `state`.
export interface DocEntryState {
  uploading: boolean;
  progress: number;
  error: string | null;
  uploaded: { filename: string; sizeBytes: number } | null;
}

export const EMPTY_DOC_STATE: DocEntryState = { uploading: false, progress: 0, error: null, uploaded: null };

export function DocumentDropzone({
  t,
  state,
  invalid,
  onPick,
}: {
  t: VendorDocTypeDef;
  state: DocEntryState;
  invalid: boolean;
  onPick: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  const tryFile = (f: File | undefined) => {
    if (!f || state.uploading) return;
    const err = fileTypeError(f, { allowSpreadsheets: !!t.spreadsheet });
    setRejection(err);
    if (!err) onPick(f);
  };

  const uploaded = state.uploaded;
  const showInvalid = invalid || !!rejection || !!state.error;

  return (
    <div className="ep-pane padding-12px-14px">
      <div className="d-flex justify-between items-center mb-8px">
        <span className="fs-13-5px fw-800">
          {t.label}
          {t.mandatory && <span className="required-mark">*</span>}
        </span>
      </div>
      <div
        className={`dropzone${uploaded ? " has-file" : ""}${showInvalid ? " invalid" : ""}${dragOver ? " dragover" : ""}`}
        data-doc-type={t.value}
        onClick={() => !state.uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!state.uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          tryFile(e.dataTransfer.files[0]);
        }}
      >
        {state.uploading ? (
          <UploadProgress value={state.progress} />
        ) : (
          <span className="dz-text">
            {uploaded ? `${uploaded.filename} (${(uploaded.sizeBytes / 1024).toFixed(0)} KB) — click or drop to replace` : "Drop a file here, or click to browse"}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={acceptFor(t)}
          onChange={(e) => {
            tryFile(e.target.files?.[0]);
            e.target.value = ""; // lets picking the same (still-rejected) file again re-trigger onChange
          }}
        />
      </div>
      {rejection && <div className="field-error">{rejection}</div>}
      {state.error && <div className="field-error">{state.error}</div>}
      {t.expires && (
        <div className="ep-field mt-8px">
          <div className="ep-k">Valid till</div>
          <input className="input maxw-220px" type="date" data-valid-till={t.value} />
        </div>
      )}
    </div>
  );
}

export function DocumentDropzones({
  docState,
  invalidTypes,
  onPick,
}: {
  docState: Record<string, DocEntryState>;
  invalidTypes: Set<string>;
  onPick: (docType: string, f: File) => void;
}) {
  const group = (title: string, types: VendorDocTypeDef[]) => (
    <div className="d-flex flex-col gap-12px" key={title}>
      <div className="ep-k">{title}</div>
      {types.map((t) => (
        <DocumentDropzone key={t.value} t={t} state={docState[t.value] ?? EMPTY_DOC_STATE} invalid={invalidTypes.has(t.value)} onPick={(f) => onPick(t.value, f)} />
      ))}
    </div>
  );
  return (
    <div className="d-flex flex-col gap-18px">
      {group("Required documents", VENDOR_DOC_TYPES.filter((t) => t.mandatory))}
      {group("Statutory & compliance — upload those that apply to you", VENDOR_DOC_TYPES.filter((t) => !t.mandatory))}
    </div>
  );
}
