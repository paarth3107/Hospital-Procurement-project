import { isFieldHidden, type FieldDef } from "../lib/formFields";

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
  if (isFieldHidden(field, raw)) return null;
  const value = raw[field.name] ?? "";
  const set = (v: string) => onChange(field.name, v);

  let input;
  if (field.kind === "textarea") {
    input = <textarea className="input" rows={2} value={value} onChange={(e) => set(e.target.value)} />;
  } else if (field.kind === "number") {
    input = <input className="input" type="number" step="any" value={value} onChange={(e) => set(e.target.value)} />;
  } else if (field.kind === "date") {
    input = <input className="input" type="date" value={value} onChange={(e) => set(e.target.value)} />;
  } else if (field.kind === "list") {
    input = <input className="input" placeholder="comma separated" value={value} onChange={(e) => set(e.target.value)} />;
  } else if (field.kind === "bool") {
    input = (
      <select className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else if (field.kind === "select") {
    input = (
      <select className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        {field.options!.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    );
  } else {
    input = <input className="input" value={value} onChange={(e) => set(e.target.value)} />;
  }

  return (
    <div className="ep-field kit-field">
      {field.label && <div className="ep-k">{field.label}</div>}
      {input}
    </div>
  );
}
