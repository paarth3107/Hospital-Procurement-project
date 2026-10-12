import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { FormField } from "../../components/FormField";
import { RequiredDocsPicker, type RequiredDocsPickerHandle } from "../../components/RequiredDocsPicker";
import { initialFieldValues, readFieldValues } from "../../lib/formFields";
import { CORE_ROWS } from "./catalogFieldDefs";
import type { CatalogProduct } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/catalog/coreDetails.js. Each row is
// optional and independently ticked on/off; an unticked row's fields are
// saved as empty (so editing an entry can remove a detail), same as
// readCoreDetails(). Exposes getValue() through a ref (same pattern as
// RequiredDocsPicker) for ProductForm's submit handler to read.
const isSet = (v: unknown) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);

export interface CoreDetailsHandle {
  getValue: () => Record<string, unknown>;
}

export const CoreDetailsSection = forwardRef<CoreDetailsHandle, { product: CatalogProduct | null }>(function CoreDetailsSection({ product }, ref) {
  const [ticked, setTicked] = useState<boolean[]>(() =>
    CORE_ROWS.map((row) => (row.docs ? (product?.required_documents.length ?? 0) > 0 : row.fields.some((f) => isSet((product as unknown as Record<string, unknown>)?.[f.name]))))
  );
  const [raw, setRaw] = useState<Record<string, string>>(() => {
    let out: Record<string, string> = {};
    for (const row of CORE_ROWS) out = { ...out, ...initialFieldValues(row.fields, product as unknown as Record<string, unknown>) };
    return out;
  });
  const [requiredDocs, setRequiredDocs] = useState<string[]>(product?.required_documents ?? []);
  const docsRef = useRef<RequiredDocsPickerHandle>(null);

  useImperativeHandle(ref, () => ({
    getValue: () => {
      const out: Record<string, unknown> = {};
      CORE_ROWS.forEach((row, i) => {
        if (row.docs) {
          out.required_documents = ticked[i] ? docsRef.current?.getValue() ?? requiredDocs : [];
          return;
        }
        const values = ticked[i] ? readFieldValues(row.fields, raw) : {};
        for (const f of row.fields) out[f.name] = values[f.name] ?? (f.kind === "list" ? [] : null);
      });
      return out;
    },
  }));

  return (
    <>
      {CORE_ROWS.map((row, i) => (
        <div className="optional-row border-bottom-1px-solid-ink-18 padding-8px-0" key={row.label}>
          <label className="optional-toggle ep-check fw-600 cursor-pointer">
            <input type="checkbox" checked={ticked[i]} onChange={(e) => setTicked((t) => t.map((x, j) => (j === i ? e.target.checked : x)))} /> {row.label}
          </label>
          {ticked[i] && (
            <div className="optional-input margin-8px-0-2px-24px d-flex flex-col gap-10px">
              {row.docs ? (
                <RequiredDocsPicker ref={docsRef} value={requiredDocs} onChange={setRequiredDocs} />
              ) : (
                row.fields.map((f) => <FormField key={f.name} field={f} raw={raw} onChange={(name, value) => setRaw((r) => ({ ...r, [name]: value }))} />)
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
});
