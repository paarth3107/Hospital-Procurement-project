import { API_BASE, api, apiHeaders } from "../api.js";
import { showResult } from "../ui.js";
import { VENDOR_DOC_TYPES } from "../constants.js";

// ---- Vendor documents (the vendor's own upload page) ----
export async function renderVendorDocuments() {
  const container = document.getElementById("vendor-documents-list");
  const resultEl = document.getElementById("vendor-documents-result");
  try {
    const docs = await api("/vendor-portal/documents");
    const byType = new Map(docs.map((d) => [d.doc_type, d]));

    container.innerHTML = VENDOR_DOC_TYPES.map((t) => {
      const doc = byType.get(t.value);
      const reqBadge = t.mandatory ? '<span class="badge badge-required">Required</span>' : '<span class="badge badge-optional">Optional</span>';
      const statusBadge = doc ? `<span class="badge badge-${doc.status}">${doc.status}</span>` : "";
      const meta = doc
        ? `<div class="doc-meta">${doc.original_filename} — ${(doc.size_bytes / 1024).toFixed(0)} KB — uploaded ${new Date(doc.uploaded_at).toLocaleString()} — <a href="#" class="doc-view-link" data-doc-id="${doc.id}">View</a></div>`
        : "";
      const rejectReason =
        doc && doc.status === "rejected" && doc.rejection_reason
          ? `<div class="doc-reject-reason">Reason: ${doc.rejection_reason}</div>`
          : "";
      return `
        <div class="doc-card">
          <div class="doc-card-head">
            <span class="doc-title">${t.label}</span>
            <span>${reqBadge} ${statusBadge}</span>
          </div>
          ${meta}
          ${rejectReason}
          <div class="dropzone" data-doc-type="${t.value}">
            ${doc ? "Drop a new file here to replace, or click to browse" : "Drop a file here, or click to browse"} (PDF, JPG, or PNG)
            <input type="file" accept=".pdf,.jpg,.jpeg,.png">
          </div>
        </div>`;
    }).join("");

    wireVendorDocumentDropzones();
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load documents: " + err.message, false);
  }
}

function wireVendorDocumentDropzones() {
  document.querySelectorAll("#vendor-documents-list .dropzone").forEach((zone) => {
    const input = zone.querySelector("input[type=file]");
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files[0]) uploadVendorDocument(zone.dataset.docType, input.files[0]);
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file) uploadVendorDocument(zone.dataset.docType, file);
    });
  });

  document.querySelectorAll("#vendor-documents-list .doc-view-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      downloadVendorDocument(link.dataset.docId);
    });
  });
}

async function uploadVendorDocument(docType, file) {
  const resultEl = document.getElementById("vendor-documents-result");
  const formData = new FormData();
  formData.append("doc_type", docType);
  formData.append("file", file);
  try {
    // Deliberately not going through api()'s JSON Content-Type -- leaving
    // headers unset here lets fetch set the correct multipart boundary itself.
    await api("/vendor-portal/documents", { method: "POST", body: formData });
    showResult(resultEl, `Uploaded ${file.name}.`, true);
    renderVendorDocuments();
  } catch (err) {
    showResult(resultEl, "Could not upload: " + err.message, false);
  }
}

async function downloadVendorDocument(docId) {
  const resultEl = document.getElementById("vendor-documents-result");
  try {
    const res = await fetch(API_BASE + `/vendor-portal/documents/${docId}/download`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not open document");
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  } catch (err) {
    showResult(resultEl, err.message, false);
  }
}
