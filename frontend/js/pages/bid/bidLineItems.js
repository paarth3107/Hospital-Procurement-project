import { api, API_BASE, apiHeaders } from "../../api.js";
import { esc, inr, kicker, tag, stateTag, th } from "../../kit.js";
import { showResult } from "../../ui.js";
import { modalConfirm } from "../../modal.js";
import { fieldHtml, readFields, wireConditionalFields } from "../catalog/formKit.js";
import { vendorCatalogSpec } from "../catalog/attrSummary.js";
import { attachmentsHtml, wireAttachments } from "./bidAttachments.js";
import { BID_DETAIL_FIELDS_BY_TYPE } from "./bidFields.js";
import { importCsvRows, buildTemplateCsv, downloadTextFile } from "./bidLineItemsCsv.js";
import { LINE_DETAIL_FIELDS_BY_TYPE } from "../tenders/lineDetailFields.js";
import { KIND_LABELS as SPEC_ATTACHMENT_KIND_LABELS } from "../tenders/lineAttachments.js";

// ---- The vendor bid workspace for one tender (2026-10-01, replaces the old
// one-big-panel-per-line layout): same spreadsheet-grid pattern as tender
// line-item creation (../tenders/tenderLineItems.js) -- core commercial
// fields editable straight in the grid (or pasted/CSV-imported from Excel),
// technical answers + compliance + attachments behind a per-row "Details"
// expansion. Unlike the tender grid, a vendor can't add or remove rows: the
// line set is fixed by which lines they were invited to bid on.
//
// Bidding is one TENDER-level action from the vendor's side (2026-10-01,
// user-directed), not independent per-line submit/withdraw/amend -- a Bid
// row still exists per (line, vendor) server-side (needed for independent
// per-line technical evaluation, Split-Award and price-confidentiality
// unlock timing), but the vendor never submits one directly. Each line is
// either filled in (saved as a draft, same as before) or explicitly marked
// "Skip" (a local-only flag, never persisted -- a skipped line is simply
// left out of the final submit payload); the bottom Submit Bid button stays
// disabled until every line is resolved one way or the other, then submits
// every non-skipped line in one bulk request. There's no post-submission
// per-line withdraw/amend -- "Reopen for editing" reverts the whole tender's
// submitted lines back to draft if something needs fixing before the
// deadline. ----

let tenderCtx = null; // { tender_id, tender_title, tender_type, bid_due_date }
let rows = [];
let expandedRows = new Set();
let onChange = () => {};

const container = () => document.getElementById("bid-line-items");
export const onRowsChanged = (fn) => (onChange = fn);
export const getRows = () => rows;
export const getTenderCtx = () => tenderCtx;

const NUMERIC_FIELDS = new Set(["unit_price", "gst_percent", "other_duties", "delivery_lead_days", "quote_validity_days"]);

function rowFromForm(form) {
  const { context: ctx, requirements: req, bid, locked, lock_reason } = form;
  return {
    line_item_id: ctx.line_item_id,
    product_name: ctx.product_name,
    qty: ctx.qty,
    uom: ctx.uom,
    procurement_type: ctx.procurement_type,
    shelf_life_tracked: ctx.shelf_life_tracked,
    technical_eval_method: ctx.technical_eval_method,
    technical_weight: ctx.technical_weight,
    price_weight: ctx.price_weight,
    split_award_allowed: ctx.split_award_allowed,
    catalog_spec: ctx.catalog_spec,
    line_details_spec: ctx.line_details,
    spec_attachments: ctx.attachments,
    requirements: req,
    locked,
    lock_reason,
    bid_id: bid?.id ?? null,
    status: bid?.status ?? null,
    unit_price: bid?.unit_price ?? null,
    gst_percent: bid?.gst_percent ?? null,
    other_duties: bid?.other_duties ?? null,
    delivery_lead_days: bid?.delivery_lead_days ?? null,
    quote_validity_days: bid?.quote_validity_days ?? null,
    payment_terms: bid?.payment_terms ?? "",
    compliant_full: bid?.compliant_full ?? false,
    technical_compliance: bid?.technical_compliance ?? "",
    brand_offered: bid?.brand_offered ?? "",
    comments: bid?.comments ?? "",
    details: bid?.details ?? {},
    attachments: bid?.attachments ?? [],
  };
}

export function setFromServer(tenderBidsOut) {
  tenderCtx = {
    tender_id: tenderBidsOut.tender_id,
    tender_title: tenderBidsOut.tender_title,
    tender_type: tenderBidsOut.tender_type,
    tender_description: tenderBidsOut.tender_description,
    facility_name: tenderBidsOut.facility_name,
    terms_document_filename: tenderBidsOut.terms_document_filename,
    open_tender: tenderBidsOut.open_tender,
    is_rate_contract: tenderBidsOut.is_rate_contract,
    contract_start_date: tenderBidsOut.contract_start_date,
    contract_end_date: tenderBidsOut.contract_end_date,
    rate_contract_document_filename: tenderBidsOut.rate_contract_document_filename,
    bid_due_date: tenderBidsOut.bid_due_date,
  };
  rows = tenderBidsOut.lines.map((f) => ({ ...rowFromForm(f), skipped: false }));
  expandedRows = new Set();
  render();
}

// "skipped" is local-only (never sent to or received from the server, see the
// module comment) -- preserved explicitly since rowFromForm() only knows
// about server-derived fields.
function applyForm(i, form) {
  const skipped = rows[i]?.skipped ?? false;
  Object.assign(rows[i], rowFromForm(form));
  rows[i].skipped = skipped;
}

const landedUnitPrice = (row) => (row.unit_price != null ? row.unit_price * (1 + (row.gst_percent || 0) / 100) + (row.other_duties || 0) : null);
const lineTotal = (row) => {
  const l = landedUnitPrice(row);
  return l != null ? l * row.qty : 0;
};

function bidDetailFields(row) {
  const need = (name) => row.requirements.required_fields.includes(`details.${name}`);
  return (BID_DETAIL_FIELDS_BY_TYPE[row.procurement_type] || []).map((f) => ({ ...f, label: f.label + (need(f.name) ? " *" : "") }));
}

const EVAL_METHOD_LABEL = { qualify_disqualify: "Qualify/Disqualify", scored: "Scored technical ranking" };

// "What's being asked" -- read-only reference material a vendor needs before
// bidding (2026-10-01, user-directed): the catalog spec (deliberately never
// the staff-only reorder level/price band/min mapping rating -- see
// vendorCatalogSpec's own comment), this tender's own per-line overrides, how
// the line will be evaluated, and the officer's uploaded spec documents.
function evalSummary(row) {
  const bits = [row.technical_eval_method === "qcbs" ? `QCBS (Technical ${row.technical_weight}% / Price ${row.price_weight}%)` : EVAL_METHOD_LABEL[row.technical_eval_method] || row.technical_eval_method];
  if (row.split_award_allowed) bits.push("Split-award allowed — this line's quantity may be divided among more than one vendor");
  return bits.join(" · ");
}

function lineDetailsSummary(row) {
  const fields = LINE_DETAIL_FIELDS_BY_TYPE[row.procurement_type] || [];
  const bits = [];
  for (const f of fields) {
    const v = row.line_details_spec?.[f.name];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    bits.push(`${f.label}: ${Array.isArray(v) ? v.join(", ") : f.kind === "bool" ? (v ? "Yes" : "No") : v}`);
  }
  return bits.length ? bits.join(" · ") : "Nothing extra specified for this tender.";
}

function specAttachmentsHtml(row) {
  if (!row.spec_attachments?.length) return '<div class="hint">No documents attached to this line.</div>';
  return `<div class="d-flex flex-col gap-6px">${row.spec_attachments
    .map(
      (a) => `<div class="d-flex gap-10px items-center fs-12-5px">
        <span class="ep-tag">${esc(SPEC_ATTACHMENT_KIND_LABELS[a.kind] || a.kind)}</span>
        <a href="#" data-view-spec-att="${a.id}">${esc(a.custom_label || a.original_filename)}</a>
        <span class="ep-sub">${(a.size_bytes / 1024).toFixed(0)} KB</span>
      </div>`
    )
    .join("")}</div>`;
}

function buildBidPayload(row) {
  return {
    unit_price: row.unit_price,
    gst_percent: row.gst_percent,
    other_duties: row.other_duties,
    delivery_lead_days: row.delivery_lead_days,
    quote_validity_days: row.quote_validity_days,
    payment_terms: (row.payment_terms || "").trim() || null,
    compliant_full: !!row.compliant_full,
    technical_compliance: row.compliant_full ? null : (row.technical_compliance || "").trim() || null,
    brand_offered: (row.brand_offered || "").trim() || null,
    comments: (row.comments || "").trim() || null,
    details: row.details || {},
  };
}

// Reads the Details expansion's fields back into the row -- called before any
// save so edits aren't lost even if the panel is still open (same pattern as
// the tender grid's flushDetailsRow).
function flushDetailsRow(i) {
  const detailsEl = container().querySelector(`tr.li-details-row[data-row="${i}"]`);
  if (!detailsEl) return;
  const row = rows[i];
  row.details = readFields(detailsEl, bidDetailFields(row));
  const brandEl = detailsEl.querySelector('[name="brand_offered"]');
  if (brandEl) row.brand_offered = brandEl.value.trim();
  const compliantEl = detailsEl.querySelector('[name="compliant_full"]');
  if (compliantEl) row.compliant_full = compliantEl.checked;
  const devEl = detailsEl.querySelector('[name="technical_compliance"]');
  if (devEl) row.technical_compliance = row.compliant_full ? "" : devEl.value.trim();
  const commentsEl = detailsEl.querySelector('[name="bid_comments"]');
  if (commentsEl) row.comments = commentsEl.value.trim();
}

function flushAllExpanded() {
  for (const i of expandedRows) flushDetailsRow(i);
}

function statusTag(row) {
  if (row.skipped) return tag("Skipped", "");
  return row.status ? stateTag(row.status) : tag("Not started", "att");
}

// A line's fields lock once it's been finally submitted (no per-line amend --
// use Reopen for editing), once it's marked Skip, or for the pre-existing
// locked reasons (deadline passed, tender/line no longer open, vendor no
// longer Active).
const fieldsDisabled = (row) => row.locked || row.status === "submitted" || row.skipped;

function numCell(row, i, field) {
  return `<input class="input" type="number" step="any" min="0" data-row="${i}" data-field="${field}" value="${row[field] ?? ""}" ${fieldsDisabled(row) ? "disabled" : ""}>`;
}

// What's still missing for this line to count as "resolved" toward the
// tender-wide submit gate -- mirrors the backend's own submit_problems()
// (app/services/bids.py), close enough for a responsive client-side gate;
// the backend stays the authoritative check on the actual submit call.
// technical_compliance is handled live off row.compliant_full rather than
// trusting req.required_fields, which only reflects state as of the last
// save/load.
function rowProblems(row) {
  const req = row.requirements;
  const blank = (v) => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && !v.length);
  const problems = [];
  for (const f of req.required_fields) {
    if (f === "technical_compliance") continue;
    const v = f.startsWith("details.") ? row.details?.[f.slice("details.".length)] : row[f];
    if (blank(v)) problems.push(f);
  }
  if (req.compliance_required && !row.compliant_full && blank(row.technical_compliance)) problems.push("technical_compliance");
  const have = new Set((row.attachments || []).map((a) => a.kind));
  for (const s of req.slots) if (s.mandatory && !have.has(s.kind)) problems.push(`attachment:${s.kind}`);
  return problems;
}

function rowResolved(row) {
  if (row.locked || row.skipped || row.status === "submitted") return true;
  return rowProblems(row).length === 0;
}

function actionButtonsHtml(row, i) {
  const skipLocked = row.locked || row.status === "submitted";
  const showSaveDraft = !row.locked && !row.skipped && row.status !== "submitted";
  return `<label class="ep-check mr-8px nowrap"><input type="checkbox" data-skip-row="${i}" ${row.skipped ? "checked" : ""} ${
    skipLocked ? "disabled" : ""
  }> Skip</label>${showSaveDraft ? `<button type="button" class="ep-b" data-save-draft="${i}">Save draft</button>` : ""}`;
}

function detailsRowHtml(row, i) {
  const req = row.requirements;
  const fields = bidDetailFields(row);
  const showBrand = row.procurement_type !== "service";
  const disabled = fieldsDisabled(row);
  return `<tr class="li-details-row" data-row="${i}">
    <td class="ep-cell" colspan="12">
      ${row.lock_reason ? `<div class="ep-note warn mb-10px">${esc(row.lock_reason)}</div>` : ""}
      <div class="hint mb-6px"><b>Catalog spec (reference):</b> ${esc(vendorCatalogSpec(row.catalog_spec))}</div>
      <div class="hint mb-6px"><b>For this tender:</b> ${esc(lineDetailsSummary(row))}</div>
      <div class="hint mb-14px"><b>Evaluation:</b> ${esc(evalSummary(row))}</div>
      <div class="ep-k mb-6px">Documents provided (spec §6.4)</div>
      <div class="mb-16px">${specAttachmentsHtml(row)}</div>
      ${
        showBrand
          ? `<div class="ep-field kit-field maxw-340px mb-12px">${kicker("Brand / model offered")}<input class="input" name="brand_offered" value="${esc(row.brand_offered || "")}" ${disabled ? "disabled" : ""}></div>`
          : ""
      }
      ${
        fields.length
          ? `<div class="line-details-fields d-grid grid-cols-repeat31fr gap-10px-16px">${fields.map((f) => fieldHtml(f, row.details?.[f.name])).join("")}</div>`
          : ""
      }
      <div class="ep-field mt-14px">
        <label class="ep-check"><input type="checkbox" name="compliant_full" ${row.compliant_full ? "checked" : ""} ${disabled ? "disabled" : ""}> Meets the specification fully — no deviations${
    req.compliance_required ? " *" : ""
  }</label>
      </div>
      <div class="ep-field" data-compliance-deviation ${row.compliant_full ? "hidden" : ""}>
        ${kicker("What is not compliant / deviations from the specification" + (req.required_fields.includes("technical_compliance") ? " *" : ""))}
        <textarea class="input w-full resize-y" name="technical_compliance" rows="3" ${disabled ? "disabled" : ""}>${esc(row.technical_compliance || "")}</textarea>
      </div>
      <div class="ep-field mt-14px">
        ${kicker("Comments (optional)")}
        <textarea class="input w-full resize-y" name="bid_comments" rows="3" placeholder="Anything else you'd like to add for this line" ${disabled ? "disabled" : ""}>${esc(row.comments || "")}</textarea>
      </div>
      <div class="ep-k mt-16px mb-6px">Attachments (spec §8.3)</div>
      <div class="bid-attachments" data-row="${i}">${attachmentsHtml({ attachments: row.attachments }, req, disabled)}</div>
    </td>
  </tr>`;
}

function rowHtml(row, i) {
  const total = lineTotal(row);
  const expanded = expandedRows.has(i);
  return `<tr class="li-row" data-row="${i}">
    <td class="ep-cell li-rownum">${i + 1}</td>
    <td class="ep-cell li-product-name">${esc(row.product_name)} <span class="ep-sub">${esc(row.procurement_type)}</span></td>
    <td class="ep-cell">${row.qty}${row.uom ? " " + esc(row.uom) : ""}</td>
    <td class="ep-cell">${statusTag(row)}</td>
    <td class="ep-cell">${numCell(row, i, "unit_price")}</td>
    <td class="ep-cell">${numCell(row, i, "gst_percent")}</td>
    <td class="ep-cell">${numCell(row, i, "other_duties")}</td>
    <td class="ep-cell">${numCell(row, i, "delivery_lead_days")}</td>
    <td class="ep-cell">${numCell(row, i, "quote_validity_days")}</td>
    <td class="ep-cell"><input class="input" type="text" data-row="${i}" data-field="payment_terms" value="${esc(row.payment_terms || "")}" ${fieldsDisabled(row) ? "disabled" : ""}></td>
    <td class="ep-cell li-total">${total ? inr(total) : "—"}</td>
    <td class="ep-cell nowrap">
      <button type="button" class="ep-b li-details-btn" data-row="${i}">${expanded ? "Hide" : "Details"}</button>
      ${actionButtonsHtml(row, i)}
    </td>
  </tr>${expanded ? detailsRowHtml(row, i) : ""}`;
}

function render() {
  container().innerHTML = `
    <div class="li-grid-wrap">
      <table class="ep-table li-grid">
        ${th("#", "Product", "Qty", "Status", "Unit Price (₹)", "GST %", "Other Duties", "Lead (d)", "Validity (d)", "Payment Terms", "Landed Total", "")}
        <tbody>${
          rows.length ? rows.map((r, i) => rowHtml(r, i)).join("") : `<tr><td class="ep-cell hint" colspan="12">No lines you're invited to bid on in this tender.</td></tr>`
        }</tbody>
      </table>
    </div>
  `;
  container().querySelectorAll(".line-details-fields").forEach(wireConditionalFields);
  for (let i = 0; i < rows.length; i++) {
    if (!expandedRows.has(i)) continue;
    const attContainer = container().querySelector(`.bid-attachments[data-row="${i}"]`);
    if (!attContainer) continue;
    wireAttachments(attContainer, rows[i].bid_id, {
      ensureBid: () => ensureBidSaved(i),
      onChanged: async () => {
        const form = await api(`/vendor-portal/bids/line/${rows[i].line_item_id}`);
        applyForm(i, form);
        render();
      },
      onError: (m) => alert(m),
    });
  }
  updateSubmitGate();
  onChange();
}

// Recomputes whether the tender-wide Submit Bid button is enabled (every line
// resolved -- filled in or skipped) and whether the tender is already
// submitted (shows Reopen for editing instead). Called after every render()
// and on every flat-grid keystroke, since those fields don't otherwise
// trigger a full render (see the input listener below).
function updateSubmitGate() {
  const submitBtn = document.getElementById("bid-submit-btn");
  if (!submitBtn) return;
  const reopenBtn = document.getElementById("bid-reopen-btn");
  const titleEl = document.getElementById("bid-gate-title");
  const bodyEl = document.getElementById("bid-gate-body");
  const isSubmitted = rows.some((r) => r.status === "submitted");
  reopenBtn.hidden = !isSubmitted;
  submitBtn.hidden = isSubmitted;
  if (isSubmitted) {
    titleEl.textContent = "Bid submitted";
    bodyEl.textContent = "Your bid for this tender has been submitted. Use Reopen for editing if you need to change something before the deadline.";
    return;
  }
  if (!rows.length) {
    submitBtn.disabled = true;
    titleEl.textContent = "Nothing to bid on";
    bodyEl.textContent = "There are no lines to bid on in this tender.";
    return;
  }
  const unresolved = rows.filter((r) => !rowResolved(r));
  submitBtn.disabled = unresolved.length > 0;
  if (unresolved.length) {
    titleEl.textContent = "Not ready to submit";
    bodyEl.textContent = `${unresolved.length} line(s) still need an answer — fill them in or mark them Skip: ${unresolved.map((r) => r.product_name).join(", ")}`;
  } else {
    titleEl.textContent = "Ready to submit";
    bodyEl.textContent = "Every line has been answered (bid or skipped). Reopen for editing is available before the deadline if you need to change something after submitting.";
  }
}

async function ensureBidSaved(i) {
  const row = rows[i];
  if (row.bid_id != null) return row.bid_id;
  flushDetailsRow(i);
  const body = { ...buildBidPayload(row), submit: false };
  const form = await api(`/vendor-portal/bids/line/${row.line_item_id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  applyForm(i, form);
  if (row.bid_id == null) throw new Error("Could not save this bid line — try again.");
  return row.bid_id;
}

async function saveRow(i) {
  flushDetailsRow(i);
  const row = rows[i];
  const body = { ...buildBidPayload(row), submit: false };
  const form = await api(`/vendor-portal/bids/line/${row.line_item_id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  applyForm(i, form);
  expandedRows.delete(i); // Save draft closes its Details panel
  render();
}

// Bulk-saves every unlocked, non-skipped row's current values as a draft in
// one request (2026-10-01) -- mirrors the tender line-item grid's own bulk
// save, and is what makes CSV-imported/pasted values actually persist
// without clicking through each row one at a time. The actual bid
// submission is tender-wide (submitBid() below), not part of this.
export async function saveAllDrafts() {
  flushAllExpanded();
  expandedRows.clear();
  const resultEl = document.getElementById("bid-result");
  const candidates = rows.filter((r) => !r.locked && !r.skipped && r.status !== "submitted");
  if (!candidates.length) {
    showResult(resultEl, "Nothing to save.", true);
    return;
  }
  const payload = { lines: candidates.map((r) => ({ line_item_id: r.line_item_id, ...buildBidPayload(r), submit: false })) };
  try {
    const results = await api(`/vendor-portal/bids/tender/${tenderCtx.tender_id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const byId = new Map(results.map((r) => [r.line_item_id, r]));
    const errors = [];
    rows.forEach((row, i) => {
      const res = byId.get(row.line_item_id);
      if (!res) return;
      if (res.ok) applyForm(i, res.form);
      else errors.push(`${row.product_name}: ${res.error}`);
    });
    render();
    const okCount = results.filter((r) => r.ok).length;
    if (errors.length) showResult(resultEl, `${okCount} line(s) saved. ${errors.length} line(s) could not be saved: ${errors.join("; ")}`, false);
    else showResult(resultEl, `${okCount} line(s) saved as draft.`, true);
  } catch (err) {
    showResult(resultEl, "Could not save: " + err.message, false);
  }
}

// The tender-wide Submit Bid action (2026-10-01, user-directed): submits
// every line the vendor filled in (skipped lines are left out entirely) in
// one bulk request. Only reachable once updateSubmitGate() has already
// determined every line is resolved, so a per-line failure here would mean
// the client's own completeness check (rowProblems) disagreed with the
// server's -- reported plainly rather than silently retried.
export async function submitBid() {
  flushAllExpanded();
  const resultEl = document.getElementById("bid-result");
  const candidates = rows.filter((r) => !r.locked && !r.skipped && r.status !== "submitted");
  if (!candidates.length) {
    showResult(resultEl, "Nothing to submit.", false);
    return;
  }
  const ok = await modalConfirm(
    "Submit your bid for this tender? This covers every line you've filled in — skipped lines are left out. You can use Reopen for editing before the deadline if you need to change something.",
    { title: "Submit Bid", confirmLabel: "Submit" }
  );
  if (!ok) return;
  const payload = { lines: candidates.map((r) => ({ line_item_id: r.line_item_id, ...buildBidPayload(r), submit: true })) };
  try {
    const results = await api(`/vendor-portal/bids/tender/${tenderCtx.tender_id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const byId = new Map(results.map((r) => [r.line_item_id, r]));
    const errors = [];
    rows.forEach((row, i) => {
      const res = byId.get(row.line_item_id);
      if (!res) return;
      if (res.ok) applyForm(i, res.form);
      else errors.push(`${row.product_name}: ${res.error}`);
    });
    render();
    if (errors.length) showResult(resultEl, `Could not submit: ${errors.join("; ")}`, false);
    else showResult(resultEl, "Bid submitted.", true);
  } catch (err) {
    showResult(resultEl, "Could not submit: " + err.message, false);
  }
}

// Undoes a tender-wide submission (2026-10-01, user-directed: there's no
// per-line withdraw/amend once submitted -- this is the only way back before
// the deadline). Every submitted line reverts to draft server-side.
export async function reopenBid() {
  const ok = await modalConfirm(
    "Reopen this bid for editing? Every submitted line goes back to draft — you'll need to submit again before the deadline.",
    { title: "Reopen for Editing", confirmLabel: "Reopen", danger: true }
  );
  if (!ok) return;
  const resultEl = document.getElementById("bid-result");
  try {
    const forms = await api(`/vendor-portal/bids/tender/${tenderCtx.tender_id}/reopen`, { method: "POST" });
    const byId = new Map(forms.map((f) => [f.context.line_item_id, f]));
    rows.forEach((row, i) => {
      const f = byId.get(row.line_item_id);
      if (f) applyForm(i, f);
    });
    render();
    showResult(resultEl, "Bid reopened for editing.", true);
  } catch (err) {
    showResult(resultEl, "Could not reopen: " + err.message, false);
  }
}

export function downloadTemplate() {
  flushAllExpanded();
  downloadTextFile("bid-lines-template.csv", buildTemplateCsv(rows));
}

export function applyCsvImport(text) {
  const { updates, errors } = importCsvRows(text, rows);
  rows.forEach((row) => {
    const patch = updates.get(String(row.line_item_id));
    if (patch) Object.assign(row, patch);
  });
  render();
  return errors;
}

container().addEventListener("input", (e) => {
  const el = e.target;
  const field = el.dataset.field;
  if (!field) return;
  const i = Number(el.dataset.row);
  const row = rows[i];
  if (!row) return;
  row[field] = NUMERIC_FIELDS.has(field) ? (el.value === "" ? null : Number(el.value)) : el.value;
  if (field === "unit_price" || field === "gst_percent" || field === "other_duties") {
    const totalCell = el.closest("tr").querySelector(".li-total");
    const t = lineTotal(row);
    if (totalCell) totalCell.textContent = t ? inr(t) : "—";
  }
  updateSubmitGate(); // flat-grid fields don't otherwise trigger a re-render
});

container().addEventListener("change", (e) => {
  if (e.target.dataset.skipRow !== undefined) {
    const i = Number(e.target.dataset.skipRow);
    rows[i].skipped = e.target.checked;
    render();
    return;
  }
  if (e.target.name === "compliant_full") {
    const devField = e.target.closest("td").querySelector("[data-compliance-deviation]");
    if (devField) devField.hidden = e.target.checked;
    updateSubmitGate();
    return;
  }
  // Live hint only (spec 8.2 Asset distributor rule) -- the mandatory tag is
  // recomputed for real from the saved bid's details on the next render.
  if (e.target.name === "bidding_as_distributor") {
    const detailsEl = e.target.closest(".li-details-row");
    const i = Number(detailsEl.dataset.row);
    const slot = detailsEl.querySelector('[data-slot="manufacturer_authorization"] [data-mandatory-tag]');
    const already = rows[i].attachments.some((a) => a.kind === "manufacturer_authorization");
    if (slot && !already) slot.innerHTML = e.target.value === "true" ? tag("required", "att") : '<span class="ep-sub">optional</span>';
  }
});

container().addEventListener("click", async (e) => {
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
  const draftBtn = e.target.closest("[data-save-draft]");
  if (draftBtn) {
    const i = Number(draftBtn.dataset.saveDraft);
    try {
      await saveRow(i);
    } catch (err) {
      alert(err.message);
    }
    return;
  }
  const viewSpecAtt = e.target.closest("[data-view-spec-att]");
  if (viewSpecAtt) {
    e.preventDefault();
    const i = Number(viewSpecAtt.closest("tr.li-details-row").dataset.row);
    try {
      const res = await fetch(`${API_BASE}/vendor-portal/bids/line/${rows[i].line_item_id}/spec-attachments/${viewSpecAtt.dataset.viewSpecAtt}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (err) {
      alert(err.message);
    }
  }
});

document.getElementById("bid-download-template-btn").addEventListener("click", downloadTemplate);

const csvFileInput = document.getElementById("bid-csv-file-input");
document.getElementById("bid-upload-csv-btn").addEventListener("click", () => csvFileInput.click());
csvFileInput.addEventListener("change", async () => {
  const file = csvFileInput.files[0];
  csvFileInput.value = "";
  if (!file) return;
  const text = await file.text();
  const errors = applyCsvImport(text);
  const errBox = document.getElementById("bid-import-errors");
  if (errors.length) {
    errBox.hidden = false;
    errBox.innerHTML = `<div class="fw-700 mb-6px">${errors.length} row(s) need fixing:</div><ul class="margin-0 pl-18px">${errors
      .map((e) => `<li>${esc(e)}</li>`)
      .join("")}</ul>`;
  } else {
    errBox.hidden = true;
    errBox.innerHTML = "";
  }
});

document.getElementById("bid-save-all-btn").addEventListener("click", async () => {
  const btn = document.getElementById("bid-save-all-btn");
  btn.disabled = true;
  try {
    await saveAllDrafts();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("bid-submit-btn").addEventListener("click", async () => {
  const btn = document.getElementById("bid-submit-btn");
  btn.disabled = true;
  try {
    await submitBid();
  } finally {
    updateSubmitGate(); // re-derives the right disabled/hidden state rather than blindly re-enabling
  }
});

document.getElementById("bid-reopen-btn").addEventListener("click", async () => {
  const btn = document.getElementById("bid-reopen-btn");
  btn.disabled = true;
  try {
    await reopenBid();
  } finally {
    btn.disabled = false;
  }
});
