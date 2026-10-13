import { useRef, useState } from "react";
import { VENDOR_DOC_TYPES, acceptFor, type VendorDocTypeDef } from "../../lib/constants";

// Ported from frontend/js/pages/register/registerDocuments.js's single
// dropzone -- one per VENDOR_DOC_TYPES entry. `chosenFiles` (keyed by doc
// type) lives in the parent (RegisterPage), not here, since the parent also
// needs it at submit time and for the "missing mandatory document"
// highlight -- this component just renders one zone and reports picks up
// via `onFile`.
export function DocumentDropzone({ t, file, invalid, onFile }: { t: VendorDocTypeDef; file: File | null; invalid: boolean; onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="ep-pane padding-12px-14px">
      <div className="d-flex justify-between items-center mb-8px">
        <span className="fs-13-5px fw-800">{t.label}</span>
        <span className="ep-tag" data-t={t.mandatory ? "att" : undefined}>
          {t.mandatory ? "Required" : "Optional"}
        </span>
      </div>
      <div
        className={`dropzone${file ? " has-file" : ""}${invalid ? " invalid" : ""}${dragOver ? " dragover" : ""}`}
        data-doc-type={t.value}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        <span className="dz-text">{file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB) — click or drop to replace` : "Drop a file here, or click to browse"}</span>
        <input
          ref={inputRef}
          type="file"
          accept={acceptFor(t)}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>
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
  chosenFiles,
  invalidTypes,
  onFile,
}: {
  chosenFiles: Map<string, File>;
  invalidTypes: Set<string>;
  onFile: (docType: string, f: File) => void;
}) {
  const group = (title: string, types: VendorDocTypeDef[]) => (
    <div className="d-flex flex-col gap-12px" key={title}>
      <div className="ep-k">{title}</div>
      {types.map((t) => (
        <DocumentDropzone key={t.value} t={t} file={chosenFiles.get(t.value) ?? null} invalid={invalidTypes.has(t.value)} onFile={(f) => onFile(t.value, f)} />
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
