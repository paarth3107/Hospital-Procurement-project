import { API_BASE, api, apiHeaders } from "../../api.js";
import { esc, tag } from "../../kit.js";

// Attachments for one line's bid (spec 8.3): one slot per document the line
// type calls for, mandatory ones flagged. Uploading needs a saved bid, so the
// caller passes `ensureBid()` which saves a draft first when none exists yet.
const ACCEPT = ".pdf,.docx,.xlsx,.jpg,.jpeg,.png";

export function attachmentsHtml(bid, req, locked) {
  const files = bid?.attachments || [];
  return `<div style="display:flex;flex-direction:column;gap:12px">${req.slots
    .map((s) => {
      const mine = files.filter((f) => f.kind === s.kind);
      return `<div data-slot="${s.kind}" style="padding-bottom:10px;border-bottom:1px solid rgba(32,30,29,.15)">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:600">${esc(s.label)}</span>
          <span data-mandatory-tag>${s.mandatory ? tag(mine.length ? "provided" : "required", mine.length ? "pos" : "att") : '<span class="ep-sub">optional</span>'}</span>
          ${locked ? "" : `<button type="button" class="ep-b" data-upload="${s.kind}" style="margin-left:auto">Upload</button>`}
        </div>
        ${mine
          .map(
            (f) => `<div style="display:flex;gap:10px;align-items:center;margin-top:6px;font-size:12.5px">
              <a href="#" data-view-att="${f.id}">${esc(f.original_filename)}</a><span class="ep-sub">${(f.size_bytes / 1024).toFixed(0)} KB${f.description ? " · " + esc(f.description) : ""}</span>
              ${locked ? "" : `<button type="button" class="ep-b" data-remove-att="${f.id}" style="padding:0 8px" aria-label="Remove">×</button>`}</div>`
          )
          .join("")}
      </div>`;
    })
    .join("")}</div>`;
}

export function wireAttachments(container, bidId, { ensureBid, onChanged, onError }) {
  container.querySelectorAll("[data-upload]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = ACCEPT;
      picker.addEventListener("change", async () => {
        if (!picker.files[0]) return;
        try {
          const id = bidId ?? (await ensureBid());
          const fd = new FormData();
          fd.append("kind", btn.dataset.upload);
          fd.append("file", picker.files[0]);
          await api(`/vendor-portal/bids/${id}/attachments`, { method: "POST", body: fd });
          onChanged();
        } catch (err) {
          onError("Could not upload: " + err.message);
        }
      });
      picker.click();
    })
  );
  container.querySelectorAll("[data-remove-att]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api(`/vendor-portal/bids/${bidId}/attachments/${btn.dataset.removeAtt}`, { method: "DELETE" });
        onChanged();
      } catch (err) {
        onError("Could not remove: " + err.message);
      }
    })
  );
  container.querySelectorAll("[data-view-att]").forEach((a) =>
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(`${API_BASE}/vendor-portal/bids/${bidId}/attachments/${a.dataset.viewAtt}/download`, { headers: apiHeaders() });
        if (!res.ok) throw new Error("Could not open the file");
        window.open(URL.createObjectURL(await res.blob()), "_blank");
      } catch (err) {
        onError(err.message);
      }
    })
  );
}
