import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { modalConfirm } from "../../modal.js";
import { setCatalog, setRows, startWithOneBlankRow, getRows, rowsForPayload, firstRowProblem, onLinesChanged, totalBudget } from "./tenderLineItems.js";
import { inr, tag } from "../../kit.js";
import { showTenderDetail, hideTenderDetail } from "./tenderDetail.js";

// ---- The tender editor form ----
// One form serves both "New Tender" and editing an existing Draft: all
// header fields plus the full line-item list live in it, and "Save as
// Draft" / "Submit for Approval" both persist everything first (POST for
// new, PUT for existing). Non-Draft tenders open read-only.
const form = document.getElementById("tender-form");
const resultEl = document.getElementById("tender-result");

let currentTenderId = null; // null = creating a new tender
let currentStatus = "draft";
let onTendersChanged = () => {};

export const initTenderForm = (callbacks) => (onTendersChanged = callbacks.onTendersChanged);
export const isFormOpen = () => !form.hidden;

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
  if (!form.elements.title.value.trim()) problem = ["Title missing", "Give the tender a title before sending it for approval."];
  else if (!form.elements.bid_due_date.value) problem = ["Bid due date missing", "A bid due date is required before the tender can be sent for approval."];
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

export async function openTenderForm(tender) {
  currentTenderId = tender ? tender.id : null;
  currentStatus = tender ? tender.status : "draft";
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
    el.max_invites.value = tender.max_invites ?? "";
    el.bid_due_date.value = tender.bid_due_date ? toLocalInputValue(tender.bid_due_date) : "";
    const items = await api(`/tenders/${tender.id}/line-items`);
    setRows(items.map((li) => ({ product_master_id: li.product_master_id, qty: li.qty, estimated_price: li.estimated_price })));
    showTenderDetail(tender.id, tender.status);
  } else {
    startWithOneBlankRow();
    hideTenderDetail();
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
    facility_id: Number(data.facility_id),
    title: data.title,
    description: data.description || null,
    tender_type: data.tender_type,
    department: data.department || null,
    min_rating_threshold: data.min_rating_threshold ? Number(data.min_rating_threshold) : 0,
    max_invites: data.max_invites ? Number(data.max_invites) : null,
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
  if (!form.elements.bid_due_date.value) return "Bid Due Date is required to submit for approval.";
  if (getRows().length === 0) return "Add at least one line item to submit for approval.";
  return null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentStatus !== "draft") return;
  const action = e.submitter?.dataset.action || "save";
  const problem = firstRowProblem() || (action === "submit" ? submitProblem() : null);
  if (problem) {
    showResult(resultEl, problem, false);
    return;
  }
  const options = { headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload()) };
  try {
    const tender = currentTenderId
      ? await api(`/tenders/${currentTenderId}`, { method: "PUT", ...options })
      : await api("/tenders", { method: "POST", ...options });
    currentTenderId = tender.id;

    if (action === "submit") {
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

    showResult(resultEl, `Tender #${tender.id} saved as draft.`, true);
    onTendersChanged();
    document.getElementById("tender-form-title").textContent = `Tender #${tender.id}`;
    showTenderDetail(tender.id, tender.status);
    updateGate();
  } catch (err) {
    showResult(resultEl, "Could not save tender: " + err.message, false);
  }
});

document.getElementById("tender-form-cancel-btn").addEventListener("click", closeTenderForm);
