import { API_BASE, api, apiHeaders } from "../api.js";
import { showResult } from "../ui.js";
import { modalPrompt, modalConfirm } from "../modal.js";
import { VENDOR_DOC_TYPES } from "../constants.js";

// ---- Vendor approval queue ----
export async function loadVendors() {
  const filter = document.getElementById("status-filter").value;
  const qs = filter ? `?status_filter=${filter}` : "";
  const tbody = document.querySelector("#vendor-table tbody");
  const resultEl = document.getElementById("queue-result");
  try {
    const vendors = await api("/vendors" + qs);
    tbody.innerHTML = "";
    if (vendors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">No vendors in this status.</td></tr>';
    }
    for (const v of vendors) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>#${v.id}</td>
        <td>${v.legal_name}</td>
        <td>${v.gstin}</td>
        <td>${v.contact_person}<br><span style="color:#888;">${v.email}</span></td>
        <td><span class="status-pill status-${v.status}">${v.status.replace("_", " ")}</span></td>
        <td class="row-actions"><button data-id="${v.id}">Review</button></td>`;
      tbody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load vendors: " + err.message, false);
  }
}

document.getElementById("status-filter").addEventListener("change", loadVendors);
document.getElementById("refresh-btn").addEventListener("click", loadVendors);

// ---- Vendor document review (Category Manager / Procurement Admin / System Admin) ----
let currentReviewVendorId = null;
// Which document IDs have actually been opened in *this* review session --
// Verify/Reject stay disabled until the reviewer has opened the file at
// least once, otherwise it's too easy to rubber-stamp every document
// without ever looking at it. Resets whenever a different vendor is opened.
let reviewedDocIds = new Set();

document.querySelector("#vendor-table tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  currentReviewVendorId = Number(btn.dataset.id);
  reviewedDocIds = new Set();
  document.getElementById("vendor-review-detail").hidden = false;
  loadVendorReview();
});

document.getElementById("close-vendor-review-btn").addEventListener("click", () => {
  document.getElementById("vendor-review-detail").hidden = true;
  currentReviewVendorId = null;
});

async function downloadVendorDocumentForReview(vendorId, docId) {
  const resultEl = document.getElementById("vendor-review-result");
  try {
    const res = await fetch(API_BASE + `/vendors/${vendorId}/documents/${docId}/download`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not open document");
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
    return true;
  } catch (err) {
    showResult(resultEl, err.message, false);
    return false;
  }
}

async function loadVendorReview() {
  const resultEl = document.getElementById("vendor-review-result");
  const decidable = ["pending_verification", "info_requested"];
  try {
    const [vendor, docs] = await Promise.all([
      api(`/vendors/${currentReviewVendorId}`),
      api(`/vendors/${currentReviewVendorId}/documents`),
    ]);

    document.getElementById("vendor-review-title").textContent = `${vendor.legal_name} — Vendor #${vendor.id}`;
    document.getElementById("vendor-review-info").innerHTML = `
      <p style="font-size:13px; color:#555;">
        GSTIN ${vendor.gstin} — ${vendor.contact_person} (${vendor.email})<br>
        Status: <span class="status-pill status-${vendor.status}">${vendor.status.replace("_", " ")}</span>
        ${vendor.rejection_reason ? `<br>Note on file: ${vendor.rejection_reason}` : ""}
      </p>`;

    const byType = new Map(docs.map((d) => [d.doc_type, d]));
    document.getElementById("vendor-review-documents").innerHTML = VENDOR_DOC_TYPES.map((t) => {
      const doc = byType.get(t.value);
      const reqBadge = t.mandatory ? '<span class="badge badge-required">Required</span>' : '<span class="badge badge-optional">Optional</span>';
      const statusBadge = doc ? `<span class="badge badge-${doc.status}">${doc.status}</span>` : '<span class="badge badge-optional">Not uploaded</span>';
      const meta = doc
        ? `<div class="doc-meta">${doc.original_filename} — ${(doc.size_bytes / 1024).toFixed(0)} KB — <a href="#" class="doc-view-link" data-doc-id="${doc.id}">View</a></div>`
        : "";
      const rejectReason = doc && doc.status === "rejected" && doc.rejection_reason ? `<div class="doc-reject-reason">Reason: ${doc.rejection_reason}</div>` : "";
      const viewed = doc && reviewedDocIds.has(doc.id);
      const disabledAttr = doc && !viewed ? "disabled" : "";
      const viewedHint = doc && !viewed ? '<span class="hint" style="margin-left:8px;">View the document before deciding</span>' : "";
      const actions =
        doc && doc.status !== "verified"
          ? `<div class="row-actions review-actions" style="margin-top:8px;">
              <button class="approve" data-doc-id="${doc.id}" data-action="verify-doc" ${disabledAttr}>Verify</button>
              <button class="reject" data-doc-id="${doc.id}" data-action="reject-doc" ${disabledAttr}>Reject</button>
              ${viewedHint}
            </div>`
          : doc
          ? `<div class="row-actions review-actions" style="margin-top:8px;"><button class="reject" data-doc-id="${doc.id}" data-action="reject-doc" ${disabledAttr}>Reject</button>${viewedHint}</div>`
          : "";
      return `
        <div class="doc-card">
          <div class="doc-card-head"><span class="doc-title">${t.label}</span><span>${reqBadge} ${statusBadge}</span></div>
          ${meta}
          ${rejectReason}
          ${actions}
        </div>`;
    }).join("");

    const mandatoryRejected = VENDOR_DOC_TYPES.filter((t) => t.mandatory).some((t) => byType.get(t.value)?.status === "rejected");
    const banner = document.getElementById("vendor-review-mandatory-banner");
    banner.hidden = !mandatoryRejected;
    if (mandatoryRejected) {
      banner.innerHTML = "A mandatory document has been rejected. Either reject this registration outright, or request the documents again with a note explaining what's needed.";
    }
    document.getElementById("vendor-review-approve-btn").hidden = mandatoryRejected || !decidable.includes(vendor.status);
    document.getElementById("vendor-review-reject-btn").hidden = !decidable.includes(vendor.status);
    document.getElementById("vendor-review-request-info-btn").hidden = !decidable.includes(vendor.status);

    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load vendor review: " + err.message, false);
  }
}

document.getElementById("vendor-review-documents").addEventListener("click", async (e) => {
  const viewLink = e.target.closest(".doc-view-link");
  if (viewLink) {
    e.preventDefault();
    const opened = await downloadVendorDocumentForReview(currentReviewVendorId, viewLink.dataset.docId);
    if (opened) {
      reviewedDocIds.add(Number(viewLink.dataset.docId));
      loadVendorReview();
    }
    return;
  }
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const resultEl = document.getElementById("vendor-review-result");
  const { docId, action } = btn.dataset;
  try {
    if (action === "reject-doc") {
      const reason = await modalPrompt("Reason for rejecting this document (required):");
      if (!reason) return;
      await api(`/vendors/${currentReviewVendorId}/documents/${docId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    } else if (action === "verify-doc") {
      await api(`/vendors/${currentReviewVendorId}/documents/${docId}/verify`, { method: "POST" });
    }
    loadVendorReview();
  } catch (err) {
    showResult(resultEl, "Could not update document: " + err.message, false);
  }
});

document.getElementById("vendor-review-approve-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("vendor-review-result");
  const ok = await modalConfirm("Approve this vendor? They'll become Active and can start requesting catalog mappings.", { confirmLabel: "Approve" });
  if (!ok) return;
  try {
    await api(`/vendors/${currentReviewVendorId}/approve`, { method: "POST" });
    showResult(resultEl, "Vendor approved.", true);
    loadVendorReview();
    loadVendors();
  } catch (err) {
    showResult(resultEl, "Could not approve: " + err.message, false);
  }
});

document.getElementById("vendor-review-reject-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("vendor-review-result");
  const reason = await modalPrompt("Reason for rejecting this registration (required):");
  if (!reason) return;
  try {
    await api(`/vendors/${currentReviewVendorId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    showResult(resultEl, "Registration rejected.", true);
    loadVendorReview();
    loadVendors();
  } catch (err) {
    showResult(resultEl, "Could not reject: " + err.message, false);
  }
});

document.getElementById("vendor-review-request-info-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("vendor-review-result");
  const note = await modalPrompt("Note to the vendor explaining what's needed (required):");
  if (!note) return;
  try {
    await api(`/vendors/${currentReviewVendorId}/request-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    showResult(resultEl, "Documents requested again.", true);
    loadVendorReview();
    loadVendors();
  } catch (err) {
    showResult(resultEl, "Could not request info: " + err.message, false);
  }
});
