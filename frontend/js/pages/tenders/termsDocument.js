import { api, API_BASE, apiHeaders } from "../../api.js";
import { esc } from "../../kit.js";
import { modalAlert, modalConfirm } from "../../modal.js";

// The tender's Terms & Conditions document (2026-10-07, user-directed):
// payment terms, delivery terms, penalty clauses, validity period -- read
// from the actual document the officer uploads, not typed in. Mandatory
// before submission (tenders.py). Usable only once the tender has a real id,
// same as a line item's own attachments.
const box = () => document.getElementById("terms-document-box");

function fmtSize(bytes) {
  if (bytes == null) return "";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function renderTermsDocument(tender, onChange = () => {}) {
  const el = box();
  if (!tender) {
    el.innerHTML = `<div class="hint">Save as Draft first, then upload the document.</div>`;
    return;
  }
  const filename = tender.terms_document_filename;
  el.innerHTML = filename
    ? `<div class="d-flex items-center gap-10px flex-wrap">
        <span class="fw-600">${esc(filename)}</span>
        <span class="ep-sub">${fmtSize(tender.terms_document_size)}</span>
        <button type="button" class="ep-b" data-terms-download>Download</button>
        <button type="button" class="ep-b" data-terms-replace>Replace</button>
        <button type="button" class="ep-b" data-terms-remove>Remove</button>
      </div>`
    : `<div class="d-flex items-center gap-10px flex-wrap">
        <span class="fs-12px text-danger-700">Required before submission.</span>
        <button type="button" class="ep-b" data-terms-upload>Upload document</button>
      </div>`;

  el.querySelector("[data-terms-download]")?.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API_BASE}/tenders/${tender.id}/terms-document/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (err) {
      modalAlert(err.message);
    }
  });
  (el.querySelector("[data-terms-upload]") || el.querySelector("[data-terms-replace]"))?.addEventListener("click", () => pickAndUpload(tender, onChange));
  el.querySelector("[data-terms-remove]")?.addEventListener("click", async () => {
    const ok = await modalConfirm("Remove the Terms & Conditions document?");
    if (!ok) return;
    try {
      const updated = await api(`/tenders/${tender.id}/terms-document`, { method: "DELETE" });
      renderTermsDocument(updated, onChange);
      onChange(updated);
    } catch (err) {
      modalAlert(err.message);
    }
  });
}

function pickAndUpload(tender, onChange) {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".pdf,.doc,.docx";
  picker.addEventListener("change", async () => {
    if (!picker.files[0]) return;
    try {
      const fd = new FormData();
      fd.append("file", picker.files[0]);
      const updated = await api(`/tenders/${tender.id}/terms-document`, { method: "POST", body: fd });
      renderTermsDocument(updated, onChange);
      onChange(updated);
    } catch (err) {
      modalAlert(err.message);
    }
  });
  picker.click();
}
