import { api, API_BASE, apiHeaders } from "../../api.js";
import { esc, th, inr } from "../../kit.js";
import { modalPrompt } from "../../modal.js";
import { fieldHtml, readFields, wireConditionalFields } from "../catalog/formKit.js";
import { attrSummary } from "../catalog/attrSummary.js";
import { LINE_DETAIL_FIELDS_BY_TYPE } from "./lineDetailFields.js";
import { attachmentsHtml } from "./lineAttachments.js";
import { CORE_COLUMNS, EVAL_METHODS, importCsvRows, buildTemplateCsv, downloadTextFile, parseBool } from "./lineItemsCsv.js";

// ---- The tender line-item grid (2026-09-30, replaces one-panel-per-line):
// a real tender can carry hundreds of lines, so this is a flat spreadsheet-
// style table instead -- type, tab, or paste a block copied straight out of
// Excel (paste columns match the CSV template's core columns exactly), or
// upload a CSV wholesale. Type-specific fields (12-14 per type, see
// lineDetailFields.js) don't fit a flat grid, so they live behind a
// per-row "Details" expansion instead of their own column each. ----
let products = [];
let rows = []; // see blankRow() for shape
let expandedRows = new Set(); // row indices currently showing their Details expansion
let onChange = () => {};
let tenderId = null; // set once the tender itself has been saved -- attachments need a real tender + line id to upload to
// Saves the current draft and refreshes rows with server-assigned ids --
// registered by tenderForm.js (onNeedSave), called transparently the moment
// an attachment upload needs a real line id, so there's no "save first"
// wall (2026-10-01, user-directed: the same ensureBid() pattern bidPage.js
// already uses for the vendor's own bid attachments).
let requestSave = async () => {
  throw new Error("Can't save yet -- try again in a moment.");
};

const container = () => document.getElementById("tender-line-items");
const blankRow = () => ({
  id: null, // real once the tender's been saved at least once; attachments need this
  product_master_id: null,
  product_code_input: "", // what's typed/pasted/imported -- kept even if it doesn't resolve, so a typo stays visible to fix
  qty: null,
  estimated_price: null,
  technical_eval_method: null, // null = not chosen yet; defaulted by type once a catalog entry resolves
  technical_weight: null,
  price_weight: null,
  split_award_allowed: false,
  min_rating_threshold_override: null,
  line_details: {},
  attachments: [],
});

export const setCatalog = (list) => (products = list);
export const setTenderId = (id) => (tenderId = id);
export const getRows = () => rows;
export const onLinesChanged = (fn) => (onChange = fn);
export const onNeedSave = (fn) => (requestSave = fn);

// For loading a genuinely different (or brand new) tender only -- a save's
// own refresh uses applySavedLineItems() instead, which updates rows in
// place rather than replacing the array (see its own comment for why).
export function setRows(newRows) {
  rows = newRows.map((r) => {
    const row = { ...blankRow(), ...r };
    row.product_code_input = products.find((p) => p.id === row.product_master_id)?.code || "";
    return row;
  });
  expandedRows = new Set();
  render();
}
export function startWithOneBlankRow() {
  rows = [blankRow()];
  expandedRows = new Set();
  render();
}

// Spec §9.2.1: Item lines default to Qualify/Disqualify; Asset and Service
// lines default to Scored Technical Ranking. Either can be changed freely --
// this only picks a sensible starting point once a catalog entry resolves.
const DEFAULT_EVAL_METHOD = { item: "qualify_disqualify", asset: "scored", service: "scored" };
// Spec §9.4's own suggested starting points.
const DEFAULT_QCBS_WEIGHTS = { item: [70, 30], asset: [70, 30], service: [60, 40] };
const EVAL_METHOD_SHORT = { qualify_disqualify: "Qualify/Disqualify", scored: "Scored", qcbs: "QCBS" };

// Paste (and CSV) column order -- keep this in lockstep with lineItemsCsv.js's
// CORE_COLUMNS; "product_code" there maps to this row's product_code_input.
const GRID_COLUMNS = CORE_COLUMNS.map((c) => (c === "product_code" ? "product_code_input" : c));
const NUMERIC_FIELDS = new Set(["qty", "estimated_price", "technical_weight", "price_weight", "min_rating_threshold_override"]);

const productOf = (row) => products.find((p) => p.id === row.product_master_id);
export const lineBudget = (row) => (row.qty && row.estimated_price ? row.qty * row.estimated_price : 0);
export const totalBudget = () => rows.reduce((n, r) => n + lineBudget(r), 0);

// Re-resolves product_master_id from whatever's typed in the code cell.
// Only called on commit (blur/change/paste/import), never on every
// keystroke, so line_details isn't wiped out mid-typing.
function resolveProduct(row) {
  const code = row.product_code_input.trim().toLowerCase();
  const p = code ? products.find((x) => x.code.trim().toLowerCase() === code) : null;
  const changedProduct = (p?.id ?? null) !== row.product_master_id;
  row.product_master_id = p ? p.id : null;
  if (changedProduct) row.line_details = {};
  if (p && !row.technical_eval_method) row.technical_eval_method = DEFAULT_EVAL_METHOD[p.procurement_type];
  // Service tenure has a catalog default, not an authoritative value -- pre-fill
  // it so the common case (this engagement matches the standard term) needs no
  // typing, while still leaving it editable for the engagements that don't.
  if (changedProduct && p?.procurement_type === "service" && row.line_details?.tenure_months == null) {
    const defaultTenure = p.type_specific_attrs?.default_tenure_months;
    if (defaultTenure != null) row.line_details = { ...row.line_details, tenure_months: defaultTenure };
  }
}

function flushDetailsRow(i) {
  const detailsEl = container().querySelector(`tr.li-details-row[data-row="${i}"] .line-details-fields`);
  const p = productOf(rows[i]);
  if (detailsEl && p) rows[i].line_details = readFields(detailsEl, LINE_DETAIL_FIELDS_BY_TYPE[p.procurement_type] || []);
}

function detailsRowHtml(row, i, p, fields) {
  const catalogSpec = attrSummary(p);
  return `<tr class="li-details-row" data-row="${i}">
    <td class="ep-cell" colspan="12">
      <div class="hint mb-10px"><b>Catalog spec (from the master item, reference only):</b> ${esc(catalogSpec)}</div>
      ${
        fields.length
          ? `<div class="line-details-fields d-grid grid-cols-repeat31fr gap-10px-16px">${fields.map((f) => fieldHtml(f, row.line_details?.[f.name])).join("")}</div>`
          : '<div class="hint">Nothing else to add for this line -- the catalog spec above covers it.</div>'
      }
      <div class="ep-k mt-16px mb-6px">Attachments (spec §6.4)</div>
      <div class="li-attachments" data-row="${i}">${attachmentsHtml(row.attachments, p.procurement_type)}</div>
    </td>
  </tr>`;
}

function rowHtml(row, i) {
  const p = productOf(row);
  const codeTyped = row.product_code_input.trim() !== "";
  const codeInvalid = codeTyped && !p;
  const total = lineBudget(row);
  const qcbs = row.technical_eval_method === "qcbs";
  const expanded = expandedRows.has(i);
  const detailFields = p ? LINE_DETAIL_FIELDS_BY_TYPE[p.procurement_type] || [] : [];
  return `<tr class="li-row" data-row="${i}">
    <td class="ep-cell li-rownum">${i + 1}</td>
    <td class="ep-cell"><input class="input${codeInvalid ? " invalid" : ""}" list="li-catalog-codes" data-row="${i}" data-col="0" data-field="product_code_input" value="${esc(row.product_code_input)}" placeholder="code"></td>
    <td class="ep-cell li-product-name">${p ? `${esc(p.name)} <span class="ep-sub">${esc(p.procurement_type)}</span>` : codeInvalid ? '<span class="text-danger-700">unknown code</span>' : ""}</td>
    <td class="ep-cell"><input class="input" type="number" step="any" min="0" data-row="${i}" data-col="1" data-field="qty" value="${row.qty ?? ""}"></td>
    <td class="ep-cell"><input class="input" type="number" step="any" min="0" data-row="${i}" data-col="2" data-field="estimated_price" value="${row.estimated_price ?? ""}"></td>
    <td class="ep-cell"><select class="input" data-row="${i}" data-col="3" data-field="technical_eval_method">
      <option value="">${p ? "default" : "—"}</option>
      ${EVAL_METHODS.map((m) => `<option value="${m}" ${row.technical_eval_method === m ? "selected" : ""}>${EVAL_METHOD_SHORT[m]}</option>`).join("")}
    </select></td>
    <td class="ep-cell">${qcbs ? `<input class="input" type="number" step="1" min="0" data-row="${i}" data-col="4" data-field="technical_weight" value="${row.technical_weight ?? ""}">` : '<span class="hint">—</span>'}</td>
    <td class="ep-cell">${qcbs ? `<input class="input" type="number" step="1" min="0" data-row="${i}" data-col="5" data-field="price_weight" value="${row.price_weight ?? ""}">` : '<span class="hint">—</span>'}</td>
    <td class="ep-cell text-center"><input type="checkbox" data-row="${i}" data-col="6" data-field="split_award_allowed" ${row.split_award_allowed ? "checked" : ""}></td>
    <td class="ep-cell"><input class="input" type="number" step="0.1" min="0" max="100" data-row="${i}" data-col="7" data-field="min_rating_threshold_override" value="${row.min_rating_threshold_override ?? ""}" placeholder="default"></td>
    <td class="ep-cell li-total">${total ? inr(total) : "—"}</td>
    <td class="ep-cell nowrap">
      <button type="button" class="ep-b li-details-btn" data-row="${i}" ${p ? "" : "disabled"}>${expanded ? "Hide" : "Details"}</button>
      <button type="button" class="ep-b remove-line-btn" data-row="${i}">✕</button>
    </td>
  </tr>${expanded && p ? detailsRowHtml(row, i, p, detailFields) : ""}`;
}

function render() {
  container().innerHTML = `
    <div class="li-grid-wrap">
      <table class="ep-table li-grid">
        ${th("#", "Product Code", "Product Name", "Qty", "Est. Price/Unit", "Eval Method", "Tech Wt", "Price Wt", "Split Award", "Min Rating", "Line Total", "")}
        <tbody>${
          rows.length ? rows.map((r, i) => rowHtml(r, i)).join("") : `<tr><td class="ep-cell hint" colspan="12">No line items yet — add a row or upload a CSV.</td></tr>`
        }</tbody>
      </table>
    </div>
    <datalist id="li-catalog-codes">${products.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join("")}</datalist>
    <div class="hint mt-8px">${rows.length} row(s) · total estimated value ${inr(totalBudget())}</div>
  `;
  container().querySelectorAll(".line-details-fields").forEach(wireConditionalFields);
  onChange();
}

// The absolute minimum a row needs to exist as a real TenderLineItem at all:
// a resolved catalog entry, full stop -- qty, eval method/weights and
// everything else can be filled in later. A draft save should never demand
// more than this per row (2026-10-01, user-directed: no "everything must be
// perfect" wall before a document can even be attached -- that's what
// Submit's own gate, firstRowProblem()/submitProblem(), is for).
function isRowSavable(row) {
  return !!row.product_master_id;
}

// What the backend needs for each row (procurement type comes from the
// catalog entry). Rows that aren't savable yet (still blank, mid-typing) are
// left out entirely rather than sent and rejected -- they simply stay local
// until they're complete enough to become a real row.
export function rowsForPayload() {
  for (const i of expandedRows) flushDetailsRow(i);
  return rows.filter(isRowSavable).map((li) => ({
    id: li.id, // lets the backend match this against its existing row instead of recreating it, which would lose its attachments
    product_master_id: li.product_master_id,
    procurement_type: productOf(li)?.procurement_type,
    qty: li.qty,
    estimated_price: li.estimated_price,
    technical_eval_method: li.technical_eval_method || "qualify_disqualify",
    technical_weight: li.technical_weight,
    price_weight: li.price_weight,
    split_award_allowed: !!li.split_award_allowed,
    min_rating_threshold_override: li.min_rating_threshold_override,
    line_details: li.line_details || {},
  }));
}

// Applies a save's result back onto the existing rows array IN PLACE --
// never a wholesale setRows() replacement, which would wipe out any row that
// wasn't savable yet (excluded from the payload above, so absent from
// `items`) along with whatever the officer was still typing into it. Matches
// a pre-existing row by its own id; a newly-created row (id was null when
// sent) is matched by position among just the freshly-inserted items,
// ordered by id -- correct because within one save, new rows are inserted
// in payload order, so their auto-assigned ids come out in that same order
// even when interleaved with pre-existing ids that don't follow it.
export function applySavedLineItems(items) {
  const oldIds = new Set(rows.map((r) => r.id).filter((id) => id != null));
  const byOldId = new Map(items.filter((it) => oldIds.has(it.id)).map((it) => [it.id, it]));
  const freshQueue = items.filter((it) => !oldIds.has(it.id)).sort((a, b) => a.id - b.id);
  let freshIdx = 0;
  for (const row of rows) {
    if (!isRowSavable(row)) continue; // wasn't sent -- left exactly as the officer has it
    const server = row.id != null ? byOldId.get(row.id) : freshQueue[freshIdx++];
    if (!server) continue; // defensive only -- shouldn't happen after a successful save
    Object.assign(row, {
      id: server.id,
      qty: server.qty,
      estimated_price: server.estimated_price,
      technical_eval_method: server.technical_eval_method,
      technical_weight: server.technical_weight,
      price_weight: server.price_weight,
      split_award_allowed: server.split_award_allowed,
      min_rating_threshold_override: server.min_rating_threshold_override,
      line_details: server.line_details,
      attachments: server.attachments || [],
    });
  }
  render();
}

export function firstRowProblem() {
  for (let i = 0; i < rows.length; i++) {
    const li = rows[i];
    const n = i + 1;
    if (!li.product_master_id) return `Row ${n}: needs a valid catalog entry — check the product code.`;
    if (!(li.qty > 0)) return `Row ${n}: needs a quantity greater than zero.`;
    if (li.technical_eval_method === "qcbs" && (!(li.technical_weight > 0) || !(li.price_weight > 0))) {
      return `Row ${n}: QCBS needs both a technical weight and a price weight, greater than zero.`;
    }
  }
  return null;
}

// Typing updates the array and (for qty/price) the line-total cell directly,
// without a full re-render -- re-rendering every keystroke across a
// hundred-row grid would be janky and would steal focus mid-type.
container().addEventListener("input", (e) => {
  const el = e.target;
  const field = el.dataset.field;
  if (!field) return;
  const i = Number(el.dataset.row);
  const row = rows[i];
  if (!row) return;
  if (field === "product_code_input") {
    row.product_code_input = el.value;
    const code = el.value.trim().toLowerCase();
    const p = code ? products.find((x) => x.code.trim().toLowerCase() === code) : null;
    el.classList.toggle("invalid", !!code && !p);
    const nameCell = el.closest("tr").querySelector(".li-product-name");
    if (nameCell) nameCell.innerHTML = p ? `${esc(p.name)} <span class="ep-sub">${esc(p.procurement_type)}</span>` : code ? '<span class="text-danger-700">unknown code</span>' : "";
    return;
  }
  if (NUMERIC_FIELDS.has(field)) {
    row[field] = el.value === "" ? null : Number(el.value);
    if (field === "qty" || field === "estimated_price") {
      const totalCell = el.closest("tr").querySelector(".li-total");
      const total = lineBudget(row);
      if (totalCell) totalCell.textContent = total ? inr(total) : "—";
    }
    onChange();
  }
});

container().addEventListener("change", (e) => {
  if (e.target.closest(".li-details-row")) {
    const i = Number(e.target.closest(".li-details-row").dataset.row);
    flushDetailsRow(i);
    onChange();
    return;
  }
  const field = e.target.dataset.field;
  if (!field) return;
  const i = Number(e.target.dataset.row);
  const row = rows[i];
  if (!row) return;
  if (field === "product_code_input") {
    resolveProduct(row);
    render();
  } else if (field === "technical_eval_method") {
    row.technical_eval_method = e.target.value || null;
    if (e.target.value === "qcbs" && !row.technical_weight && !row.price_weight) {
      const p = productOf(row);
      const [tw, pw] = DEFAULT_QCBS_WEIGHTS[p?.procurement_type || "item"];
      row.technical_weight = tw;
      row.price_weight = pw;
    }
    render();
  } else if (field === "split_award_allowed") {
    row.split_award_allowed = e.target.checked;
  }
  onChange();
});

// No "save as draft first" wall: attaching a document silently saves the
// tender (this line included) if it hasn't been saved yet, the same
// ensureBid()-style pattern bidPage.js already uses for a vendor's own bid
// attachments. Re-reads rows[i] after the save rather than reusing a
// closed-over reference, since setRows() replaces every row object.
async function ensureLineSaved(i) {
  if (rows[i].id != null) return rows[i].id;
  await requestSave();
  if (rows[i].id == null) throw new Error("Could not save this line -- fix any errors above and try again.");
  return rows[i].id;
}

async function uploadAttachment(i, kind) {
  let customLabel = null;
  if (kind === "other") {
    customLabel = await modalPrompt("What is this document?", "e.g. Site photograph");
    if (customLabel === null) return; // cancelled
  }
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".pdf,.docx,.xlsx,.jpg,.jpeg,.png";
  picker.addEventListener("change", async () => {
    if (!picker.files[0]) return;
    try {
      const lineId = await ensureLineSaved(i);
      const fd = new FormData();
      fd.append("kind", kind);
      if (customLabel) fd.append("custom_label", customLabel);
      fd.append("file", picker.files[0]);
      const att = await api(`/tenders/${tenderId}/line-items/${lineId}/attachments`, { method: "POST", body: fd });
      rows[i].attachments.push(att);
      render();
      onChange();
    } catch (err) {
      alert("Could not upload: " + err.message);
    }
  });
  picker.click();
}

async function removeAttachment(i, attachmentId) {
  try {
    await api(`/tenders/${tenderId}/line-items/${rows[i].id}/attachments/${attachmentId}`, { method: "DELETE" });
    rows[i].attachments = rows[i].attachments.filter((a) => a.id !== attachmentId);
    render();
    onChange();
  } catch (err) {
    alert("Could not remove: " + err.message);
  }
}

async function viewAttachment(lineId, attachmentId) {
  try {
    const res = await fetch(`${API_BASE}/tenders/${tenderId}/line-items/${lineId}/attachments/${attachmentId}/download`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not open the file");
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  } catch (err) {
    alert(err.message);
  }
}

container().addEventListener("click", (e) => {
  const detailsBtn = e.target.closest(".li-details-btn");
  if (detailsBtn) {
    const i = Number(detailsBtn.dataset.row);
    if (expandedRows.has(i)) {
      flushDetailsRow(i);
      expandedRows.delete(i);
    } else {
      expandedRows.add(i);
    }
    render();
    return;
  }
  const removeBtn = e.target.closest(".remove-line-btn");
  if (removeBtn) {
    const i = Number(removeBtn.dataset.row);
    const shifted = new Set();
    for (const idx of expandedRows) if (idx !== i) shifted.add(idx > i ? idx - 1 : idx);
    expandedRows = shifted;
    rows.splice(i, 1);
    render();
    onChange();
    return;
  }
  const uploadBtn = e.target.closest("[data-upload]");
  if (uploadBtn) {
    const i = Number(uploadBtn.closest(".li-attachments").dataset.row);
    uploadAttachment(i, uploadBtn.dataset.upload);
    return;
  }
  const removeAttBtn = e.target.closest("[data-remove-att]");
  if (removeAttBtn) {
    const i = Number(removeAttBtn.closest(".li-attachments").dataset.row);
    removeAttachment(i, Number(removeAttBtn.dataset.removeAtt));
    return;
  }
  const viewAttLink = e.target.closest("[data-view-att]");
  if (viewAttLink) {
    e.preventDefault();
    const i = Number(viewAttLink.closest(".li-attachments").dataset.row);
    viewAttachment(rows[i].id, Number(viewAttLink.dataset.viewAtt));
  }
});

// Paste from Excel: only intercept a genuine multi-cell paste (contains a
// tab or a newline) -- a normal single-value paste is left to the browser.
// Pasted columns line up with GRID_COLUMNS, the same order the CSV template
// and Download-template button use, so a block copied straight out of a
// spreadsheet the officer already had drops in as-is.
container().addEventListener("paste", (e) => {
  const target = e.target.closest("input[data-field], select[data-field]");
  if (!target) return;
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
  e.preventDefault();
  const startRow = Number(target.dataset.row);
  const startCol = Number(target.dataset.col);
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.forEach((line, li) => {
    const rowIdx = startRow + li;
    while (rowIdx >= rows.length) rows.push(blankRow());
    const row = rows[rowIdx];
    line.split("\t").forEach((val, ci) => {
      const colIdx = startCol + ci;
      if (colIdx >= GRID_COLUMNS.length) return;
      const field = GRID_COLUMNS[colIdx];
      const v = val.trim();
      if (field === "product_code_input") {
        row.product_code_input = v;
        resolveProduct(row);
      } else if (NUMERIC_FIELDS.has(field)) {
        row[field] = v === "" ? null : Number(v);
      } else if (field === "technical_eval_method") {
        const match = EVAL_METHODS.find((m) => m.toLowerCase() === v.toLowerCase());
        if (match) row.technical_eval_method = match;
      } else if (field === "split_award_allowed") {
        row.split_award_allowed = parseBool(v);
      }
    });
  });
  render();
  onChange();
});

document.getElementById("add-line-item-btn").addEventListener("click", () => {
  rows.push(blankRow());
  render();
});
document.getElementById("add-10-line-items-btn").addEventListener("click", () => {
  for (let n = 0; n < 10; n++) rows.push(blankRow());
  render();
});
document.getElementById("li-download-template-btn").addEventListener("click", () => {
  downloadTextFile("tender-line-items-template.csv", buildTemplateCsv());
});

const csvFileInput = document.getElementById("li-csv-file-input");
document.getElementById("li-upload-csv-btn").addEventListener("click", () => csvFileInput.click());
csvFileInput.addEventListener("change", async () => {
  const file = csvFileInput.files[0];
  csvFileInput.value = ""; // lets the same filename be re-uploaded later (e.g. after fixing rows)
  if (!file) return;
  const text = await file.text();
  const { rows: imported, errors } = importCsvRows(text, products);
  if (imported.length) {
    rows.push(
      ...imported.map((r) => {
        const row = { ...blankRow(), ...r };
        if (!row.technical_eval_method) {
          const p = products.find((x) => x.id === row.product_master_id);
          if (p) row.technical_eval_method = DEFAULT_EVAL_METHOD[p.procurement_type];
        }
        return row;
      })
    );
    render();
    onChange();
  }
  const errBox = document.getElementById("li-import-errors");
  if (errors.length) {
    errBox.hidden = false;
    errBox.innerHTML = `<div class="fw-700 mb-6px">${imported.length} row(s) added, ${errors.length} row(s) need fixing before they can be added:</div><ul class="margin-0 pl-18px">${errors
      .map((e) => `<li>${esc(e)}</li>`)
      .join("")}</ul><div class="hint mt-6px">Fix these rows in your file and upload just them again — the rows already added above don't need to be re-uploaded.</div>`;
  } else {
    errBox.hidden = true;
    errBox.innerHTML = "";
  }
});
