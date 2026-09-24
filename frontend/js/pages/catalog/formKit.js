// Tiny helpers for building catalog forms from field descriptions.
//
// A field description looks like:
//   { name: "warranty_months", label: "Warranty (months)", kind: "number" }
// kinds: text | textarea | number | bool | select (needs options) | list (comma-separated)
// Optional: showWhen: { otherFieldName: "value" } -> only shown while that field has that value.

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function fieldHtml(f, value) {
  const attrs = `name="${f.name}" data-kind="${f.kind}"`;
  let input;
  if (f.kind === "textarea") input = `<textarea class="input" ${attrs} rows="2">${esc(value)}</textarea>`;
  else if (f.kind === "number") input = `<input class="input" ${attrs} type="number" step="any" value="${esc(value)}">`;
  else if (f.kind === "list") input = `<input class="input" ${attrs} value="${esc(Array.isArray(value) ? value.join(", ") : "")}" placeholder="comma separated">`;
  else if (f.kind === "bool")
    input = `<select class="input" ${attrs}><option value="">—</option><option value="true" ${value === true ? "selected" : ""}>Yes</option><option value="false" ${value === false ? "selected" : ""}>No</option></select>`;
  else if (f.kind === "select")
    input = `<select class="input" ${attrs}><option value="">—</option>${f.options
      .map(([v, l]) => `<option value="${v}" ${value === v ? "selected" : ""}>${l}</option>`)
      .join("")}</select>`;
  else input = `<input class="input" ${attrs} value="${esc(value)}">`;
  const when = f.showWhen ? ` data-show-when-field="${Object.keys(f.showWhen)[0]}" data-show-when-value="${Object.values(f.showWhen)[0]}"` : "";
  return `<div class="ep-field kit-field"${when}>${f.label ? `<div class="ep-k">${f.label}</div>` : ""}${input}</div>`;
}

// Reads every described field out of a container; blank fields are left out
// entirely (the backend stores only what was filled in).
export function readFields(container, fields) {
  const out = {};
  for (const f of fields) {
    const el = container.querySelector(`[name="${f.name}"]`);
    if (!el || el.closest("[hidden]")) continue;
    const raw = el.value.trim();
    if (raw === "") continue;
    if (f.kind === "number") out[f.name] = Number(raw);
    else if (f.kind === "bool") out[f.name] = raw === "true";
    else if (f.kind === "list") out[f.name] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    else out[f.name] = raw;
  }
  return out;
}

// Wires showWhen: hides fields until their controlling field has the value.
export function wireConditionalFields(container) {
  const update = () =>
    container.querySelectorAll("[data-show-when-field]").forEach((el) => {
      const controller = container.querySelector(`[name="${el.dataset.showWhenField}"]`);
      el.hidden = !controller || controller.value !== el.dataset.showWhenValue;
    });
  container.addEventListener("change", update);
  update();
}
