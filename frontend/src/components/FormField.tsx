import { useState } from "react";
import { isFieldHidden, type FieldDef } from "../lib/formFields";
import { Req } from "./Req";

// Ported from frontend/js/pages/catalog/formKit.js's fieldHtml()/
// wireConditionalFields(). `raw` is the whole sibling field-value map (not
// just this field's own value) so a showWhen condition can read another
// field's current value -- same reasoning formKit.js's single shared
// container had.
export function FormField({
  field,
  raw,
  onChange,
}: {
  field: FieldDef;
  raw: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  // On-blur validation (2026-10-28, user-directed), same pattern as every
  // other field in the app: red border + an error line underneath, only
  // once the field's actually been touched. Self-contained here (not
  // threaded through every FormField caller's own fieldErrors state)
  // since only fields that declare a `validate` function ever show one.
  const [error, setError] = useState<string | null>(null);

  if (isFieldHidden(field, raw)) return null;
  const value = raw[field.name] ?? "";
  const set = (v: string) => {
    onChange(field.name, v);
    if (error) setError(field.validate ? field.validate(v) : null);
  };
  const check = () => setError(field.validate ? field.validate(value) : null);
  const cls = `input${error ? " invalid" : ""}`;

  let input;
  if (field.kind === "textarea") {
    input = <textarea className={cls} rows={2} value={value} onChange={(e) => set(e.target.value)} onBlur={check} />;
  } else if (field.kind === "number") {
    input = <input className={cls} type="number" step="any" value={value} onChange={(e) => set(e.target.value)} onBlur={check} />;
  } else if (field.kind === "date") {
    input = <input className={cls} type="date" value={value} onChange={(e) => set(e.target.value)} onBlur={check} />;
  } else if (field.kind === "list") {
    input = <input className={cls} placeholder="comma separated" value={value} onChange={(e) => set(e.target.value)} onBlur={check} />;
  } else if (field.kind === "bool") {
    input = (
      <select className={cls} value={value} onChange={(e) => set(e.target.value)} onBlur={check}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else if (field.kind === "select") {
    input = (
      <select className={cls} value={value} onChange={(e) => set(e.target.value)} onBlur={check}>
        <option value="">—</option>
        {field.options!.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    );
  } else {
    input = <input className={cls} value={value} onChange={(e) => set(e.target.value)} onBlur={check} />;
  }

  return (
    <div className="ep-field kit-field">
      {field.label && (
        <div className="ep-k">
          {field.label}
          {field.required && <Req />}
        </div>
      )}
      {input}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
