import { api, API_BASE, apiHeaders } from "../../api.js";
import { esc } from "../../kit.js";
import { modalAlert, modalConfirm } from "../../modal.js";

// A single-slot document a tender header carries, upload-replaces (2026-10-07):
// Terms & Conditions and the Rate Contract agreement are both "exactly one
// document, uploading again replaces it" fields on Tender, differing only in
// which box/endpoint/field names they use -- shared here instead of
// copy-pasted per document. Usable only once the tender has a real id, same
// as a line item's own attachments.
function fmtSize(bytes) {
  if (bytes == null) return "";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function singleDocument({ boxId, endpoint, fieldPrefix, slug, label, requiredLabel }) {
  const box = () => document.getElementById(boxId);
  const sel = (action) => `[data-${slug}-${action}]`;

  function render(tender, onChange = () => {}) {
    const el = box();
    if (!tender) {
      el.innerHTML = `<div class="hint">Save as Draft first, then upload the document.</div>`;
      return;
    }
    const filename = tender[`${fieldPrefix}_filename`];
    el.innerHTML = filename
      ? `<div class="d-flex items-center gap-10px flex-wrap">
          <span class="fw-600">${esc(filename)}</span>
          <span class="ep-sub">${fmtSize(tender[`${fieldPrefix}_size`])}</span>
          <button type="button" class="ep-b" data-${slug}-download>Download</button>
          <button type="button" class="ep-b" data-${slug}-replace>Replace</button>
          <button type="button" class="ep-b" data-${slug}-remove>Remove</button>
        </div>`
      : `<div class="d-flex items-center gap-10px flex-wrap">
          <span class="fs-12px text-danger-700">${requiredLabel}</span>
          <button type="button" class="ep-b" data-${slug}-upload>Upload document</button>
        </div>`;

    el.querySelector(sel("download"))?.addEventListener("click", async () => {
      try {
        const res = await fetch(`${API_BASE}/tenders/${tender.id}/${endpoint}/download`, { headers: apiHeaders() });
        if (!res.ok) throw new Error("Could not open the file");
        window.open(URL.createObjectURL(await res.blob()), "_blank");
      } catch (err) {
        modalAlert(err.message);
      }
    });
    (el.querySelector(sel("upload")) || el.querySelector(sel("replace")))?.addEventListener("click", () => pickAndUpload(tender, onChange));
    el.querySelector(sel("remove"))?.addEventListener("click", async () => {
      const ok = await modalConfirm(`Remove the ${label}?`);
      if (!ok) return;
      try {
        const updated = await api(`/tenders/${tender.id}/${endpoint}`, { method: "DELETE" });
        render(updated, onChange);
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
        const updated = await api(`/tenders/${tender.id}/${endpoint}`, { method: "POST", body: fd });
        render(updated, onChange);
        onChange(updated);
      } catch (err) {
        modalAlert(err.message);
      }
    });
    picker.click();
  }

  const hasDocument = () => !!document.querySelector(`#${boxId} ${sel("download")}`);

  return { render, hasDocument };
}
