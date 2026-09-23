import { api } from "../api.js";
import { showResult } from "../ui.js";
import { modalConfirm } from "../modal.js";

// ---- Tenders ----
let currentTenderId = null;

document.getElementById("add-tender-btn").addEventListener("click", () => {
  const form = document.getElementById("tender-form");
  form.hidden = !form.hidden;
  document.getElementById("add-tender-btn").textContent = form.hidden ? "+ New Tender" : "Cancel";
  if (!form.hidden) populateFacilityPicker();
});

async function populateFacilityPicker() {
  const select = document.querySelector('#tender-form select[name="facility_id"]');
  try {
    const facilities = await api("/facilities");
    select.innerHTML =
      '<option value="">— select a facility —</option>' +
      facilities.map((f) => `<option value="${f.id}">${f.name} (${f.legal_entity_code})</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("tender-result"), "Could not load facilities: " + err.message, false);
  }
}

document.getElementById("tender-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    facility_id: Number(data.facility_id),
    title: data.title,
    description: data.description || null,
    tender_type: data.tender_type,
    department: data.department || null,
    min_rating_threshold: data.min_rating_threshold ? Number(data.min_rating_threshold) : 0,
    max_invites: data.max_invites ? Number(data.max_invites) : null,
    bid_due_date: data.bid_due_date ? new Date(data.bid_due_date).toISOString() : null,
  };
  const resultEl = document.getElementById("tender-result");
  try {
    const tender = await api("/tenders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showResult(resultEl, `Created draft tender #${tender.id}: ${tender.title}`, true);
    form.reset();
    form.hidden = true;
    document.getElementById("add-tender-btn").textContent = "+ New Tender";
    loadTenders();
  } catch (err) {
    showResult(resultEl, "Could not create tender: " + err.message, false);
  }
});

export async function loadTenders() {
  const tbody = document.querySelector("#tender-table tbody");
  const resultEl = document.getElementById("tender-result");
  try {
    const tenders = await api("/tenders");
    tbody.innerHTML = "";
    if (tenders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">No tenders yet.</td></tr>';
    }
    for (const t of tenders) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.id}</td>
        <td>${t.title}</td>
        <td>${t.tender_type}</td>
        <td><span class="status-pill status-${t.status === "published" ? "active" : t.status === "withdrawn" ? "rejected" : "pending_verification"}">${t.status}</span></td>
        <td>${t.round_number}</td>
        <td class="row-actions"><button data-id="${t.id}" data-action="select">Manage</button></td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    showResult(resultEl, "Could not load tenders: " + err.message, false);
  }
}

document.querySelector("#tender-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='select']");
  if (!btn) return;
  currentTenderId = Number(btn.dataset.id);
  document.getElementById("tender-detail").hidden = false;
  document.getElementById("tender-detail-title").textContent = `Tender #${currentTenderId}`;
  populateLineItemProductPicker();
  loadLineItems();
  loadRounds();
  document.getElementById("eligibility-preview").innerHTML = "";
  await refreshTenderStatusNotice();
});

document.getElementById("close-tender-detail-btn").addEventListener("click", () => {
  document.getElementById("tender-detail").hidden = true;
  currentTenderId = null;
});

// Line items (and submission) only make sense while Draft -- rather than
// let staff fill out the whole Add Line Item form and only find out on
// submit that a Published/Pending tender rejects it, tell them upfront and,
// for Published, offer a one-click way back to Draft.
async function refreshTenderStatusNotice() {
  try {
    const tender = await api(`/tenders/${currentTenderId}`);
    renderTenderStatusNotice(tender);
  } catch (err) {
    showResult(document.getElementById("tender-result"), "Could not load tender: " + err.message, false);
  }
}

function renderTenderStatusNotice(tender) {
  const notice = document.getElementById("tender-status-notice");
  const lineItemForm = document.getElementById("line-item-form");
  const submitBtn = document.getElementById("submit-tender-btn");

  if (tender.status === "draft") {
    notice.hidden = true;
    lineItemForm.hidden = false;
    submitBtn.hidden = false;
    return;
  }

  lineItemForm.hidden = true;
  submitBtn.hidden = true;
  notice.hidden = false;
  const statusLabel = tender.status.replace("_", " ");
  if (tender.status === "published") {
    notice.innerHTML = `<span>This tender is <b>Published</b> — line items can't be added or changed while it's live.</span>`;
    const revertBtn = document.createElement("button");
    revertBtn.textContent = "Revert to Draft to Edit";
    revertBtn.addEventListener("click", () => revertTenderToDraft(tender.id));
    notice.appendChild(revertBtn);
  } else {
    notice.innerHTML = `<span>This tender is <b>${statusLabel}</b> — line items can only be added while Draft.</span>`;
  }
}

async function revertTenderToDraft(tenderId) {
  const resultEl = document.getElementById("tender-result");
  const ok = await modalConfirm(
    "Revert this tender to Draft so you can edit its line items? It will need to go through E-Tender Approval again before it's Published.",
    { confirmLabel: "Revert to Draft" }
  );
  if (!ok) return;
  try {
    const tender = await api(`/tenders/${tenderId}/withdraw-to-draft`, { method: "POST" });
    showResult(resultEl, `Tender #${tender.id} reverted to Draft.`, true);
    renderTenderStatusNotice(tender);
    loadTenders();
  } catch (err) {
    showResult(resultEl, "Could not revert to Draft: " + err.message, false);
  }
}

// Catalog entries carry their own procurement_type (item/asset/service),
// which the line-item API requires to match exactly -- picking from this
// list (instead of typing a numeric ID and a separately-guessed type) means
// that can never mismatch, and nobody needs to know the catalog's raw ID.
async function populateLineItemProductPicker() {
  const select = document.querySelector('#line-item-form select[name="product_master_id"]');
  try {
    const products = await api("/products?active=true");
    select.innerHTML =
      '<option value="">— select a catalog entry —</option>' +
      products.map((p) => `<option value="${p.id}" data-type="${p.procurement_type}">${p.code} — ${p.name} (${p.procurement_type})</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("tender-result"), "Could not load the catalog: " + err.message, false);
  }
}

document.getElementById("line-item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const select = form.querySelector('select[name="product_master_id"]');
  const procurementType = select.selectedOptions[0]?.dataset.type;
  const payload = {
    product_master_id: Number(data.product_master_id),
    procurement_type: procurementType,
    qty: Number(data.qty),
    estimated_price: data.estimated_price ? Number(data.estimated_price) : null,
  };
  const resultEl = document.getElementById("tender-result");
  try {
    await api(`/tenders/${currentTenderId}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    loadLineItems();
  } catch (err) {
    showResult(resultEl, "Could not add line item: " + err.message, false);
  }
});

async function loadLineItems() {
  const tbody = document.querySelector("#line-item-table tbody");
  const [items, products] = await Promise.all([api(`/tenders/${currentTenderId}/line-items`), api("/products")]);
  const productLabel = new Map(products.map((p) => [p.id, `${p.code} — ${p.name}`]));
  tbody.innerHTML = items.length
    ? ""
    : '<tr><td colspan="4" style="color:#888;">No line items yet.</td></tr>';
  for (const li of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${productLabel.get(li.product_master_id) || "—"} <span style="color:#888;">(#${li.product_master_id})</span></td><td>${li.procurement_type}</td><td>${li.qty}</td><td>${li.estimated_price ?? "—"}</td>`;
    tbody.appendChild(tr);
  }
}

async function loadRounds() {
  const tbody = document.querySelector("#round-table tbody");
  const rounds = await api(`/tenders/${currentTenderId}/approval-rounds`);
  tbody.innerHTML = rounds.length
    ? ""
    : '<tr><td colspan="4" style="color:#888;">Not submitted yet.</td></tr>';
  for (const r of rounds.slice().reverse()) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.round_number}</td><td>${r.decision}</td><td>${r.required_tier}</td><td>${r.comments || ""}</td>`;
    tbody.appendChild(tr);
  }
}

document.getElementById("preview-eligibility-btn").addEventListener("click", async () => {
  const el = document.getElementById("eligibility-preview");
  try {
    const preview = await api(`/tenders/${currentTenderId}/eligibility-preview`);
    el.innerHTML = preview
      .map(
        (p) =>
          `<p><strong>Line item #${p.line_item_id}</strong> (threshold ${p.threshold_applied}): ${
            p.eligible_vendors.length
              ? p.eligible_vendors.map((v) => `${v.legal_name} (score ${v.rating_score})`).join(", ")
              : '<span style="color:#a33;">zero eligible vendors — submission will be blocked</span>'
          }</p>`
      )
      .join("");
  } catch (err) {
    el.textContent = "Could not load eligibility preview: " + err.message;
  }
});

document.getElementById("submit-tender-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("tender-result");
  try {
    await api(`/tenders/${currentTenderId}/submit-for-approval`, { method: "POST" });
    showResult(resultEl, `Tender #${currentTenderId} submitted for E-Tender Approval.`, true);
    loadTenders();
    loadRounds();
    refreshTenderStatusNotice();
  } catch (err) {
    showResult(resultEl, "Could not submit for approval: " + err.message, false);
  }
});
