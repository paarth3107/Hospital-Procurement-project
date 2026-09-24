import { esc, typeTag, inr } from "../../kit.js";

// The line items inside the tender form, one prototype-style panel each:
// header (L01, type tag, name, qty · budget), an editable attribute grid on
// the left and the mandatory-attachment checklist for the line's type on the
// right. Every field of every row is editable; rows live in an array that the
// form module reads on save.
let products = [];
let rows = []; // [{ product_master_id, qty, estimated_price }]
let onChange = () => {};

const container = () => document.getElementById("tender-line-items");
const blankRow = () => ({ product_master_id: null, qty: null, estimated_price: null });

export const setCatalog = (list) => (products = list);
export const getRows = () => rows;
export const onLinesChanged = (fn) => (onChange = fn);

export function setRows(newRows) {
  rows = newRows;
  render();
}
export function startWithOneBlankRow() {
  rows = [blankRow()];
  render();
}

// Prototype §6.4.1: what each procurement type must attach. Uploading isn't
// built yet, so the checklist is shown but its buttons are disabled.
const CHECKLIST = {
  item: ["Packaging / label reference image", "Master specification sheet"],
  asset: ["Technical specification sheet", "Site layout / floor plan", "Reference configuration photograph"],
  service: ["Scope of Work (SOW) document", "Existing asset list for scope"],
};

const productOf = (row) => products.find((p) => p.id === row.product_master_id);
export const lineBudget = (row) => (row.qty && row.estimated_price ? row.qty * row.estimated_price : 0);
export const totalBudget = () => rows.reduce((n, r) => n + lineBudget(r), 0);

function panel(row, i) {
  const p = productOf(row);
  const options =
    '<option value="">— select a catalog entry —</option>' +
    products.map((x) => `<option value="${x.id}" ${x.id === row.product_master_id ? "selected" : ""}>${esc(x.code)} — ${esc(x.name)} (${esc(x.procurement_type)})</option>`).join("");
  const checklist = p
    ? CHECKLIST[p.procurement_type]
        .map(
          (name) => `<div style="display:flex;align-items:center;gap:9px;padding:7px 9px;background:rgba(32,30,29,.06);border-left:3px solid rgba(32,30,29,.4)">
            <span style="font-size:12px;font-weight:800;width:14px;color:rgba(32,30,29,.5)">–</span>
            <div style="flex:1"><div style="font-size:12.5px;font-weight:600">${name}</div><div class="ep-sub">attachments aren't built yet</div></div>
            <button type="button" class="ep-b" style="padding:3px 9px" disabled>Upload</button></div>`
        )
        .join("")
    : '<div class="hint">Pick a catalog entry to see the attachment checklist for its type.</div>';
  return `<div class="ep-pane line-panel" data-index="${i}">
    <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:2px solid rgba(32,30,29,.4)">
      <span class="ep-mono" style="font-size:12px;font-weight:800">L${String(i + 1).padStart(2, "0")}</span>
      ${p ? typeTag(p.procurement_type) : ""}
      <span style="font-size:14px;font-weight:800">${p ? esc(p.name) : "New line item"}</span>
      <div style="flex:1"></div>
      <span class="ep-sub line-budget" style="font-size:12px">${row.qty ? row.qty : "—"} · budget ${lineBudget(row) ? inr(lineBudget(row)) : "—"}</span>
      <button type="button" class="ep-b remove-line-btn" data-index="${i}">Remove</button>
    </div>
    <div style="display:grid;grid-template-columns:1.35fr 1fr">
      <div style="padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;border-right:1px solid rgba(32,30,29,.25)">
        <div class="ep-field" style="grid-column:span 2"><div class="ep-k">Catalog entry</div><select class="input" data-field="product_master_id">${options}</select></div>
        <div class="ep-field"><div class="ep-k">Quantity${p?.unit_of_measure ? ` (${esc(p.unit_of_measure)})` : ""}</div><input class="input" data-field="qty" type="number" step="0.01" value="${row.qty ?? ""}"></div>
        <div class="ep-field"><div class="ep-k">Est. price / unit (reference only)</div><input class="input" data-field="estimated_price" type="number" step="0.01" value="${row.estimated_price ?? ""}"></div>
        ${p ? `<div class="ep-field"><div class="ep-k">Category</div><div class="ep-box">${esc(p.category)}${p.sub_category ? " › " + esc(p.sub_category) : ""}</div></div>
        <div class="ep-field"><div class="ep-k">Price band on master</div><div class="ep-box">${p.price_band_min != null || p.price_band_max != null ? `${p.price_band_min != null ? inr(p.price_band_min) : "…"} – ${p.price_band_max != null ? inr(p.price_band_max) : "…"}` : "—"}</div></div>` : ""}
      </div>
      <div style="padding:14px">
        <div class="ep-k" style="margin-bottom:8px">Mandatory attachment checklist${p ? " · " + esc(p.procurement_type) : ""}</div>
        <div style="display:flex;flex-direction:column;gap:7px">${checklist}</div>
      </div>
    </div>
  </div>`;
}

function render() {
  container().innerHTML = rows.length ? rows.map(panel).join("") : '<div class="ep-pane ep-pane-pad hint">No line items yet — add at least one.</div>';
  onChange();
}

// What the backend needs for each row (procurement type comes from the catalog entry).
export function rowsForPayload() {
  return rows.map((li) => ({
    product_master_id: li.product_master_id,
    procurement_type: productOf(li)?.procurement_type,
    qty: li.qty,
    estimated_price: li.estimated_price,
  }));
}

export function firstRowProblem() {
  for (const li of rows) {
    if (!li.product_master_id) return "Every line item needs a catalog entry (or remove the empty row).";
    if (!(li.qty > 0)) return "Every line item needs a quantity greater than zero.";
  }
  return null;
}

// Typing updates the array and the panel's budget text without re-rendering
// (which would steal focus); changing the catalog entry re-renders the panel
// so its type tag and checklist follow.
container().addEventListener("input", (e) => {
  const panelEl = e.target.closest(".line-panel");
  if (!panelEl || e.target.dataset.field === "product_master_id") return;
  const i = Number(panelEl.dataset.index);
  rows[i][e.target.dataset.field] = e.target.value === "" ? null : Number(e.target.value);
  panelEl.querySelector(".line-budget").textContent = `${rows[i].qty ? rows[i].qty : "—"} · budget ${lineBudget(rows[i]) ? inr(lineBudget(rows[i])) : "—"}`;
  onChange();
});
container().addEventListener("change", (e) => {
  const panelEl = e.target.closest(".line-panel");
  if (!panelEl || e.target.dataset.field !== "product_master_id") return;
  rows[Number(panelEl.dataset.index)].product_master_id = e.target.value === "" ? null : Number(e.target.value);
  render();
});
container().addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-line-btn");
  if (!btn) return;
  rows.splice(Number(btn.dataset.index), 1);
  render();
});
document.getElementById("add-line-item-btn").addEventListener("click", () => {
  rows.push(blankRow());
  render();
});
