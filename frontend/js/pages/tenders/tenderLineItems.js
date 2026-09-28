import { esc, typeTag, inr } from "../../kit.js";

// The line items inside the tender form, one prototype-style panel each:
// header (L01, type tag, name, qty · budget), an editable attribute grid on
// the left, the mandatory-attachment checklist for the line's type on the
// right, and an "Evaluation & award" row below (spec §9.2.1, §9.4, §6.3.4).
// Every field of every row is editable; rows live in an array that the
// form module reads on save.
let products = [];
let rows = []; // see blankRow() for shape
let onChange = () => {};

const container = () => document.getElementById("tender-line-items");
const blankRow = () => ({
  product_master_id: null,
  qty: null,
  estimated_price: null,
  technical_eval_method: null, // null = not chosen yet; defaulted by type once a catalog entry is picked
  technical_weight: null,
  price_weight: null,
  split_award_allowed: false,
  min_rating_threshold_override: null,
});

export const setCatalog = (list) => (products = list);
export const getRows = () => rows;
export const onLinesChanged = (fn) => (onChange = fn);

export function setRows(newRows) {
  rows = newRows.map((r) => ({ ...blankRow(), ...r }));
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

// Spec §9.2.1: Item lines default to Qualify/Disqualify; Asset and Service
// lines default to Scored Technical Ranking. Either can be changed freely --
// this only picks a sensible starting point the first time a catalog entry
// is chosen on a line.
const DEFAULT_EVAL_METHOD = { item: "qualify_disqualify", asset: "scored", service: "scored" };
// Spec §9.4's own suggested starting points.
const DEFAULT_QCBS_WEIGHTS = { item: [70, 30], asset: [70, 30], service: [60, 40] };
const EVAL_METHOD_LABEL = { qualify_disqualify: "Qualify / disqualify, then lowest price (L1)", scored: "Scored technical ranking, then lowest price (L1)", qcbs: "QCBS — combined technical + price score (C1)" };

const productOf = (row) => products.find((p) => p.id === row.product_master_id);
export const lineBudget = (row) => (row.qty && row.estimated_price ? row.qty * row.estimated_price : 0);
export const totalBudget = () => rows.reduce((n, r) => n + lineBudget(r), 0);

function evaluationBlock(row, i) {
  const method = row.technical_eval_method || "qualify_disqualify";
  const qcbs = method === "qcbs";
  return `<div style="padding:14px;border-top:2px solid rgba(32,30,29,.4);display:grid;grid-template-columns:repeat(4,1fr);gap:12px 16px">
    <div class="ep-field"><div class="ep-k">Technical evaluation</div>
      <select class="input" data-field="technical_eval_method">${Object.entries(EVAL_METHOD_LABEL)
        .map(([v, l]) => `<option value="${v}" ${method === v ? "selected" : ""}>${l}</option>`)
        .join("")}</select></div>
    ${
      qcbs
        ? `<div class="ep-field"><div class="ep-k">Technical weight</div><input class="input" data-field="technical_weight" type="number" min="0" step="1" value="${row.technical_weight ?? ""}"></div>
           <div class="ep-field"><div class="ep-k">Price weight</div><input class="input" data-field="price_weight" type="number" min="0" step="1" value="${row.price_weight ?? ""}"></div>`
        : `<div class="ep-field" style="grid-column:span 2"></div>`
    }
    <div class="ep-field"><div class="ep-k">Min. rating for this line (optional)</div><input class="input" data-field="min_rating_threshold_override" type="number" min="0" max="100" step="0.1" value="${row.min_rating_threshold_override ?? ""}" placeholder="tender default"></div>
    <div class="ep-field" style="grid-column:span 4;display:flex;align-items:center"><label class="ep-check"><input type="checkbox" data-field="split_award_allowed" ${row.split_award_allowed ? "checked" : ""}> Split-Award allowed — this line's quantity may be divided across more than one vendor at L1 approval</label></div>
  </div>`;
}

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
    ${evaluationBlock(row, i)}
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
    technical_eval_method: li.technical_eval_method || "qualify_disqualify",
    technical_weight: li.technical_weight,
    price_weight: li.price_weight,
    split_award_allowed: !!li.split_award_allowed,
    min_rating_threshold_override: li.min_rating_threshold_override,
  }));
}

export function firstRowProblem() {
  for (const li of rows) {
    if (!li.product_master_id) return "Every line item needs a catalog entry (or remove the empty row).";
    if (!(li.qty > 0)) return "Every line item needs a quantity greater than zero.";
    if (li.technical_eval_method === "qcbs" && (!(li.technical_weight > 0) || !(li.price_weight > 0))) {
      return "A QCBS line needs both a technical weight and a price weight, greater than zero.";
    }
  }
  return null;
}

// Typing updates the array and the panel's budget text without re-rendering
// (which would steal focus); changing the catalog entry, eval method or the
// split-award checkbox re-renders the panel since those change what else is shown.
const NUMERIC_FIELDS = new Set(["qty", "estimated_price", "technical_weight", "price_weight", "min_rating_threshold_override"]);
container().addEventListener("input", (e) => {
  const panelEl = e.target.closest(".line-panel");
  const field = e.target.dataset.field;
  if (!panelEl || !field || !NUMERIC_FIELDS.has(field)) return;
  const i = Number(panelEl.dataset.index);
  rows[i][field] = e.target.value === "" ? null : Number(e.target.value);
  panelEl.querySelector(".line-budget").textContent = `${rows[i].qty ? rows[i].qty : "—"} · budget ${lineBudget(rows[i]) ? inr(lineBudget(rows[i])) : "—"}`;
  onChange();
});
container().addEventListener("change", (e) => {
  const panelEl = e.target.closest(".line-panel");
  const field = e.target.dataset.field;
  if (!panelEl || !field) return;
  const i = Number(panelEl.dataset.index);
  if (field === "product_master_id") {
    rows[i].product_master_id = e.target.value === "" ? null : Number(e.target.value);
    const p = productOf(rows[i]);
    if (p && !rows[i].technical_eval_method) {
      rows[i].technical_eval_method = DEFAULT_EVAL_METHOD[p.procurement_type];
    }
    render();
  } else if (field === "technical_eval_method") {
    rows[i].technical_eval_method = e.target.value;
    if (e.target.value === "qcbs" && !rows[i].technical_weight && !rows[i].price_weight) {
      const p = productOf(rows[i]);
      const [tw, pw] = DEFAULT_QCBS_WEIGHTS[p?.procurement_type || "item"];
      rows[i].technical_weight = tw;
      rows[i].price_weight = pw;
    }
    render();
  } else if (field === "split_award_allowed") {
    rows[i].split_award_allowed = e.target.checked;
  }
  onChange();
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
