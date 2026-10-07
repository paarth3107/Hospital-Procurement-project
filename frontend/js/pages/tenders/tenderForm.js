import { api } from "../../api.js";
import { renderOpenLink } from "./openLink.js";
import { showResult } from "../../ui.js";
import { modalConfirm } from "../../modal.js";
import { switchView } from "../../nav.js";
import { setCatalog, setTenderId, setRows, applySavedLineItems, startWithOneBlankRow, getRows, rowsForPayload, firstRowProblem, onLinesChanged, onNeedSave, totalBudget } from "./tenderLineItems.js";
import { inr, tag } from "../../kit.js";
import { showTenderDetail, hideTenderDetail } from "./tenderDetail.js";

// ---- The tender editor form -- its own screen (2026-10-01), reached from
// the Tenders list's "+ New tender" / "Manage". One form serves both "New
// Tender" and editing an existing Draft: all header fields plus the full
// line-item list live in it, and "Save as Draft" / "Submit for Approval"
// both persist everything first (POST for new, PUT for existing). Non-Draft
// tenders open read-only. ----
const form = document.getElementById("tender-form");
const resultEl = document.getElementById("tender-result");

let currentTenderId = null; // null = creating a new tender
let currentStatus = "draft";
let onTendersChanged = () => {};

export const initTenderForm = (callbacks) => (onTendersChanged = callbacks.onTendersChanged);

async function populateFacilityPicker() {
  const select = form.elements.facility_id;
  try {
    const facilities = await api("/facilities");
    select.innerHTML =
      '<option value="">— select a facility —</option>' +
      facilities.map((f) => `<option value="${f.id}">${f.name} (${f.legal_entity_code})</option>`).join("");
  } catch (err) {
    showResult(resultEl, "Could not load facilities: " + err.message, false);
  }
}

async function loadCatalog() {
  try {
    setCatalog(await api("/products?active=true"));
  } catch (err) {
    showResult(resultEl, "Could not load the catalog: " + err.message, false);
  }
}

// The gate bar at the bottom of the form (prototype): says what's blocking
// submission, or that it's ready, and shows the estimated tender value.
function updateGate() {
  const title = document.getElementById("tender-gate-title");
  const body = document.getElementById("tender-gate-body");
  const bar = document.getElementById("tender-form-actions");
  const submit = document.getElementById("submit-approval-btn");
  if (currentStatus !== "draft") {
    title.textContent = `Tender is ${currentStatus.replace("_", " ")}`;
    body.textContent = "It can't be edited in this state.";
    return;
  }
  const rows = getRows();
  let problem = null;
  if (!form.elements.facility_id.value) problem = ["Facility missing", "Select a facility before sending it for approval."];
  else if (!form.elements.title.value.trim()) problem = ["Title missing", "Give the tender a title before sending it for approval."];
  else if (!form.elements.bid_due_date.value) problem = ["Bid due date missing", "A bid due date is required before the tender can be sent for approval."];
  else if (form.elements.is_rate_contract.checked && (!form.elements.contract_start_date.value || !form.elements.contract_end_date.value))
    problem = ["Contract dates missing", "A rate contract needs both a contract start and end date before it can be sent for approval."];
  else if (rows.length === 0) problem = ["No line items", "Add at least one line item."];
  else if (firstRowProblem()) problem = ["Line item incomplete", firstRowProblem()];
  bar.style.borderLeftColor = problem ? "#ec3013" : "#201e1d";
  title.style.color = problem ? "#ae1800" : "#201e1d";
  title.textContent = problem ? problem[0] : "Ready to send for approval";
  body.textContent = problem
    ? problem[1]
    : `${rows.length} line item(s) · estimated value ${inr(totalBudget())}. The approval tier is resolved from this value; approval publishes to the eligible vendors.`;
  submit.disabled = !!problem;
}
onLinesChanged(() => updateGate());
form.addEventListener("input", updateGate);

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Shared between the initial load and the refresh after every save -- a
// freshly-created line only gets a real id (and so becomes attachment-
// capable) once the backend has assigned one.
const mapApiLineItems = (items) =>
  items.map((li) => ({
    id: li.id,
    product_master_id: li.product_master_id,
    qty: li.qty,
    estimated_price: li.estimated_price,
    technical_eval_method: li.technical_eval_method,
    technical_weight: li.technical_weight,
    price_weight: li.price_weight,
    split_award_allowed: li.split_award_allowed,
    min_rating_threshold_override: li.min_rating_threshold_override,
    line_details: li.line_details,
    attachments: li.attachments || [],
  }));

export async function openTenderForm(tender) {
  currentTenderId = tender ? tender.id : null;
  currentStatus = tender ? tender.status : "draft";
  setTenderId(currentTenderId);
  form.reset();
  form.hidden = false;
  await Promise.all([populateFacilityPicker(), loadCatalog()]);

  if (tender) {
    const el = form.elements;
    el.facility_id.value = tender.facility_id;
    el.title.value = tender.title;
    el.description.value = tender.description || "";
    el.tender_type.value = tender.tender_type;
    el.department.value = tender.department || "";
    el.min_rating_threshold.value = tender.min_rating_threshold;
    el.min_invites.value = tender.min_invites ?? "";
    el.max_invites.value = tender.max_invites ?? "";
    el.open_tender.checked = !!tender.open_tender;
    syncOpenTender();
    renderOpenLink(tender);
    el.is_rate_contract.checked = !!tender.is_rate_contract;
    el.contract_start_date.value = tender.contract_start_date || "";
    el.contract_end_date.value = tender.contract_end_date || "";
    syncRateContract();
    el.terms_and_conditions.value = tender.terms_and_conditions || "";
    el.bid_due_date.value = tender.bid_due_date ? toLocalInputValue(tender.bid_due_date) : "";
    el.publish_date.value = tender.publish_date ? toLocalInputValue(tender.publish_date) : "";
    const items = await api(`/tenders/${tender.id}/line-items`);
    setRows(mapApiLineItems(items));
    showTenderDetail(tender.id, tender.status);
  } else {
    startWithOneBlankRow();
    hideTenderDetail();
    renderOpenLink(null);
    syncRateContract();
  }

  document.getElementById("tender-form-title").textContent = tender ? `Tender #${tender.id}` : "Tender header";
  applyStatusToForm();
  updateGate();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function closeTenderForm() {
  form.hidden = true;
  hideTenderDetail();
  currentTenderId = null;
  setTenderId(null);
  switchView("tenders");
}

// Everything is editable only while Draft; anything else is read-only, with
// a one-click way back to Draft for Published tenders.
function applyStatusToForm() {
  const editable = currentStatus === "draft";
  document.getElementById("tender-fields").disabled = !editable;
  document.getElementById("tender-form-status").outerHTML = `<span class="ep-tag" id="tender-form-status"${currentStatus === "published" ? ' data-t="pos"' : currentStatus === "pending_approval" ? ' data-t="att"' : ""}>${currentStatus.replace("_", " ")}</span>`;
  document.getElementById("add-line-item-btn").hidden = !editable;
  form.querySelectorAll("button[type=submit]").forEach((b) => (b.hidden = !editable));
  const notice = document.getElementById("tender-status-notice");
  if (editable) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  if (currentStatus === "published") {
    notice.innerHTML = `<span>This tender is <b>Published</b> — it can't be edited while it's live.</span>`;
    const revertBtn = document.createElement("button");
    revertBtn.className = "ep-b";
    revertBtn.type = "button";
    revertBtn.textContent = "Revert to Draft to Edit";
    revertBtn.addEventListener("click", () => revertToDraft(currentTenderId));
    notice.appendChild(revertBtn);
  } else {
    notice.innerHTML = `<span>This tender is <b>${currentStatus.replace("_", " ")}</b> — it can only be edited while Draft.</span>`;
  }
}

async function revertToDraft(tenderId) {
  const ok = await modalConfirm(
    "Revert this tender to Draft so you can edit it? It will need to go through E-Tender Approval again before it's Published.",
    { confirmLabel: "Revert to Draft" }
  );
  if (!ok) return;
  try {
    const tender = await api(`/tenders/${tenderId}/withdraw-to-draft`, { method: "POST" });
    showResult(resultEl, `Tender #${tender.id} reverted to Draft.`, true);
    onTendersChanged();
    openTenderForm(tender);
  } catch (err) {
    showResult(resultEl, "Could not revert to Draft: " + err.message, false);
  }
}

function buildPayload() {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    // "" (nothing picked yet) must stay null, not Number("") === 0 -- 0
    // isn't a real facility id, and a Draft is allowed to not have one yet
    // (2026-10-01, user-directed: only Submit requires it).
    facility_id: data.facility_id ? Number(data.facility_id) : null,
    title: data.title,
    description: data.description || null,
    tender_type: data.tender_type,
    department: data.department || null,
    min_rating_threshold: data.min_rating_threshold ? Number(data.min_rating_threshold) : 0,
    min_invites: data.min_invites ? Number(data.min_invites) : null,
    max_invites: data.max_invites ? Number(data.max_invites) : null,
    open_tender: data.open_tender === "on",
    is_rate_contract: data.is_rate_contract === "on",
    // Cleared whenever the flag is off, same as open_link_token server-side when open_tender is off.
    contract_start_date: data.is_rate_contract === "on" ? data.contract_start_date || null : null,
    contract_end_date: data.is_rate_contract === "on" ? data.contract_end_date || null : null,
    terms_and_conditions: data.terms_and_conditions?.trim() || null,
    publish_date: data.publish_date ? new Date(data.publish_date).toISOString() : null,
    bid_due_date: data.bid_due_date ? new Date(data.bid_due_date).toISOString() : null,
    line_items: rowsForPayload(),
  };
}

// Lines that currently resolve to zero eligible vendors (they'd be held back).
async function heldLineNames(tenderId) {
  try {
    const preview = await api(`/tenders/${tenderId}/eligibility-preview`);
    return preview.filter((p) => p.eligible_vendors.length === 0).map((p) => p.product_name);
  } catch (err) {
    return [];
  }
}

function submitProblem() {
  if (!form.elements.facility_id.value) return "Select a facility before submitting for approval.";
  if (!form.elements.title.value.trim()) return "Give the tender a title before submitting for approval.";
  if (!form.elements.bid_due_date.value) return "Bid Due Date is required to submit for approval.";
  if (form.elements.is_rate_contract.checked && (!form.elements.contract_start_date.value || !form.elements.contract_end_date.value))
    return "A rate contract needs both a contract start and end date before it can be submitted for approval.";
  if (getRows().length === 0) return "Add at least one line item to submit for approval.";
  return null;
}

// Shared by the "Save as Draft" button and the attachment grid's silent
// auto-save (tenderLineItems.js's onNeedSave -- there's no "save first" wall
// before attaching a document, this runs transparently instead). Deliberately
// does NOT check firstRowProblem() -- that's a whole-grid "is this ready for
// Submit" check, and a draft must tolerate rows still being filled in.
// rowsForPayload() already leaves out whatever isn't savable yet (2026-10-01,
// user-directed); this only ever persists what actually is. Throws on
// failure rather than showing its own error when silent, so the caller
// (e.g. the upload flow) can report it in context.
async function saveDraft({ silent = false } = {}) {
  if (currentStatus !== "draft") throw new Error("This tender can only be edited while Draft.");
  // No header-field requirements here on purpose (2026-10-01, user-directed):
  // a Draft saves whatever's there, null and all -- Facility/Title/etc. are
  // only actually required once Submit is clicked (submitProblem() below),
  // same principle as firstRowProblem() only gating Submit, not every save.
  const options = { headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) };
  const tender = currentTenderId
    ? await api(`/tenders/${currentTenderId}`, { method: "PUT", ...options })
    : await api("/tenders", { method: "POST", ...options });
  currentTenderId = tender.id;
  setTenderId(tender.id);
  // Apply the saved result onto the existing rows in place -- never a
  // wholesale reload, which would wipe out any row that wasn't savable yet
  // (so absent from this response) along with whatever's still being typed
  // into it.
  const items = await api(`/tenders/${tender.id}/line-items`);
  applySavedLineItems(items);
  if (!silent) showResult(resultEl, `Tender #${tender.id} saved as draft.`, true);
  onTendersChanged();
  document.getElementById("tender-form-title").textContent = `Tender #${tender.id}`;
  showTenderDetail(tender.id, tender.status);
  renderOpenLink(tender);
  updateGate();
  return tender;
}
onNeedSave(() => saveDraft({ silent: true }));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentStatus !== "draft") return;
  const action = e.submitter?.dataset.action || "save";
  // The whole-grid completeness check (firstRowProblem) only gates Submit --
  // a draft save tolerates incomplete rows (2026-10-01, user-directed).
  const problem = action === "submit" ? firstRowProblem() || submitProblem() : null;
  if (problem) {
    showResult(resultEl, problem, false);
    return;
  }
  try {
    if (action === "submit") {
      const tender = await saveDraft({ silent: true });
      try {
        await api(`/tenders/${tender.id}/submit-for-approval`, { method: "POST" });
      } catch (err) {
        // The draft is saved; only the submit step failed.
        showResult(resultEl, `Saved as draft, but could not submit for approval: ${err.message}`, false);
        onTendersChanged();
        openTenderForm(await api(`/tenders/${tender.id}`));
        return;
      }
      const held = await heldLineNames(tender.id);
      const heldNote = held.length ? ` Note: no eligible vendor yet for ${held.join(", ")} — that line will be held back while the rest go live.` : "";
      showResult(resultEl, `Tender #${tender.id} submitted for E-Tender Approval.${heldNote}`, true);
      onTendersChanged();
      closeTenderForm();
      return;
    }

    await saveDraft();
  } catch (err) {
    showResult(resultEl, "Could not save tender: " + err.message, false);
  }
});

document.getElementById("tender-form-cancel-btn").addEventListener("click", closeTenderForm);

// Open Tender (2026-10-06): every Active vendor is invited, so the count limits don't apply.
// Disabled fields are left out of FormData, so they save as null.
const openTenderBox = document.querySelector('#tender-form [name="open_tender"]');
function syncOpenTender() {
  document.querySelector('#tender-form [name="min_invites"]').disabled = openTenderBox.checked;
  document.querySelector('#tender-form [name="max_invites"]').disabled = openTenderBox.checked;
  if (!openTenderBox.checked) renderOpenLink(null);
}
openTenderBox.addEventListener("change", syncOpenTender);

// Rate contract (2026-10-07): the contract start/end date fields only matter,
// and only show, while the flag is on.
const rateContractBox = document.querySelector('#tender-form [name="is_rate_contract"]');
function syncRateContract() {
  const show = rateContractBox.checked;
  document.getElementById("rate-contract-start-field").hidden = !show;
  document.getElementById("rate-contract-end-field").hidden = !show;
}
rateContractBox.addEventListener("change", syncRateContract);
