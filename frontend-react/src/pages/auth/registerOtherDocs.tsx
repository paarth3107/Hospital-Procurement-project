import { forwardRef, useImperativeHandle, useRef, useState } from "react";

// Ported from frontend/js/pages/register/registerOtherDocs.js --
// registration's "Other documents" section: the vendor names and attaches
// whatever else they want, as many as they like. Each row's inputs stay
// uncontrolled (plain DOM, read via ref at submit time, same as the rest of
// this form) so a chosen file in an earlier row is never lost when another
// row is added or removed -- re-rendering the list only ever adds/removes
// row *containers*, never touches an existing row's own inputs.
//
// Renders only the rows container (vanilla's `#register-other-docs`) --
// the pane heading, intro text and "+ Add another document" button are the
// parent's (its `#register-add-other-doc-btn` calls `addRow()` here), same
// split as the vanilla markup.
export interface OtherDocsHandle {
  addRow: () => void;
  appendToFormData: (formData: FormData) => void;
  reset: () => void;
}

export const OtherDocsSection = forwardRef<OtherDocsHandle>((_props, ref) => {
  const [rows, setRows] = useState<number[]>([]);
  const nextId = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    addRow() {
      setRows((r) => [...r, nextId.current++]);
    },
    // A row only counts once it has both a name and a file -- an empty row
    // someone added and never filled in is silently skipped, not an error.
    appendToFormData(formData) {
      containerRef.current?.querySelectorAll<HTMLElement>("[data-other-row]").forEach((row) => {
        const label = row.querySelector<HTMLInputElement>("[data-other-label]")?.value.trim();
        const file = row.querySelector<HTMLInputElement>("[data-other-file]")?.files?.[0];
        if (label && file) {
          formData.append("other_doc_label", label);
          formData.append("other_doc_file", file);
        }
      });
    },
    reset() {
      setRows([]);
      nextId.current = 0;
    },
  }));

  return (
    <div className="d-flex flex-col gap-10px" ref={containerRef}>
      {rows.map((id) => (
        <div className="ep-pane ep-pane-pad d-flex gap-10px items-end flex-wrap" data-other-row={id} key={id}>
          <div className="ep-field flex-2 minw-220px">
            <div className="ep-k">Document name</div>
            <input className="input" data-other-label placeholder="e.g. CE marking certificate" />
          </div>
          <div className="ep-field flex-2 minw-220px">
            <div className="ep-k">File</div>
            <input className="input" type="file" data-other-file />
          </div>
          <button type="button" className="ep-b" onClick={() => setRows((r) => r.filter((x) => x !== id))}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
});
