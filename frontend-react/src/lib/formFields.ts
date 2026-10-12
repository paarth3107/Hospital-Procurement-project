// Ported from frontend/js/pages/catalog/formKit.js -- tiny helpers for
// building catalog forms (Item/Asset/Service type-specific details, and
// Core Details' rows) from field descriptions, shared by ProductForm.tsx
// and CoreDetailsSection.tsx.
//
// A field description looks like:
//   { name: "warranty_months", label: "Warranty (months)", kind: "number" }
// kinds: text | textarea | number | bool | select (needs options) | list (comma-separated) | date
// Optional: showWhen: { otherFieldName: "value" } -> only shown while that field has that value.
export interface FieldDef {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "bool" | "select" | "list" | "date";
  options?: [string, string][];
  showWhen?: Record<string, string>;
}

// Raw field state is always a plain string per field (same as a vanilla
// <input>'s .value), converted to its typed shape only on submit -- mirrors
// formKit.js exactly rather than keeping two parallel representations.
export function initialFieldValues(fields: FieldDef[], attrs: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = attrs?.[f.name];
    if (f.kind === "list") out[f.name] = Array.isArray(v) ? v.join(", ") : "";
    else if (f.kind === "bool") out[f.name] = v === true ? "true" : v === false ? "false" : "";
    else out[f.name] = v == null ? "" : String(v);
  }
  return out;
}

export function isFieldHidden(field: FieldDef, raw: Record<string, string>): boolean {
  if (!field.showWhen) return false;
  const [controllerName, requiredValue] = Object.entries(field.showWhen)[0];
  return (raw[controllerName] ?? "") !== requiredValue;
}

// A single field's raw string -> its typed value, or undefined if blank.
// Factored out of readFieldValues() so a caller that commits one field at a
// time (the tender line-items grid's Details expansion, which has no
// "flush on submit" step -- nothing reads the DOM, so there's nothing to
// defer) can reuse the exact same conversion rules as a caller that commits
// a whole field set at once (Catalog's CoreDetailsSection/ProductForm).
export function coerceFieldValue(field: FieldDef, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (field.kind === "number") return Number(trimmed);
  if (field.kind === "bool") return trimmed === "true";
  if (field.kind === "list")
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return trimmed;
}

// Reads every described field out of its raw string state; blank/hidden
// fields are left out entirely (the backend stores only what was filled
// in) -- same as formKit.js's readFields().
export function readFieldValues(fields: FieldDef[], raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (isFieldHidden(f, raw)) continue;
    const value = coerceFieldValue(f, raw[f.name] ?? "");
    if (value !== undefined) out[f.name] = value;
  }
  return out;
}
