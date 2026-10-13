import { forwardRef, useImperativeHandle, useState } from "react";
import { VENDOR_DOC_TYPES } from "../lib/constants";

// Ported from frontend/js/pages/catalog/requiredDocs.js -- the "documents
// required from a vendor to be mapped" picker, shared by the Category Form
// here and (Phase 3b) the product forms' Core Details. A value is either a
// standard VENDOR_DOC_TYPES value, or "other:<free text>" naming a document
// the reviewer reads and verifies rather than a fixed type.
const OTHER = "other:";

export interface RequiredDocsPickerHandle {
  // Vanilla's readRequiredDocs() scoops up text typed into the "Other" box
  // but not yet "+ Add"-ed, at the moment the surrounding form is submitted
  // -- same here, via the form's submit handler calling this through a ref,
  // rather than silently dropping whatever the user hadn't clicked Add on.
  getValue: () => string[];
}

export const RequiredDocsPicker = forwardRef<RequiredDocsPickerHandle, { value: string[]; onChange: (next: string[]) => void }>(function RequiredDocsPicker(
  { value, onChange },
  ref
) {
  const [otherInput, setOtherInput] = useState("");
  const others = value.filter((v) => v.startsWith(OTHER)).map((v) => v.slice(OTHER.length));

  useImperativeHandle(ref, () => ({
    getValue: () => {
      const typed = otherInput.trim();
      if (typed && !others.some((o) => o.toLowerCase() === typed.toLowerCase())) {
        return [...value, OTHER + typed];
      }
      return value;
    },
  }));

  const toggleStandard = (docValue: string) => {
    const has = value.includes(docValue);
    onChange(has ? value.filter((v) => v !== docValue) : [...value, docValue]);
  };

  const addOther = () => {
    const text = otherInput.trim();
    if (!text) return;
    if (!others.some((o) => o.toLowerCase() === text.toLowerCase())) {
      onChange([...value, OTHER + text]);
    }
    setOtherInput("");
  };

  const removeOther = (text: string) => {
    onChange(value.filter((v) => v !== OTHER + text));
  };

  return (
    <div className="required-docs">
      <div className="d-flex flex-wrap gap-8px-18px">
        {VENDOR_DOC_TYPES.map((t) => (
          <label className="ep-check" key={t.value}>
            <input type="checkbox" checked={value.includes(t.value)} onChange={() => toggleStandard(t.value)} /> {t.label}
          </label>
        ))}
      </div>
      <div className="ep-k margin-12px-0-6px">Other document (anything not listed above)</div>
      <div className="d-flex gap-8px items-center">
        <input
          className="input maxw-380px"
          placeholder="e.g. CE marking certificate for the implant"
          value={otherInput}
          onChange={(e) => setOtherInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // Enter adds the chip, it must not submit the whole form
              addOther();
            }
          }}
        />
        <button type="button" className="ep-b" onClick={addOther}>
          + Add
        </button>
      </div>
      <div className="d-flex flex-wrap gap-6px mt-8px">
        {others.map((text) => (
          <span className="ep-tag d-inline-flex gap-6px items-center tt-none ls-0 fs-12px" key={text}>
            {text}{" "}
            <button type="button" className="border-0 bg-none cursor-pointer fw-800" onClick={() => removeOther(text)}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
});
