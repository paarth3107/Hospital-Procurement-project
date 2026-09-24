import { API_BASE, api, apiHeaders } from "../api.js";
import { showResult } from "../ui.js";
import { VENDOR_DOC_TYPES, acceptFor } from "../constants.js";
import { esc, tag, stateTag, th, fmtDate, expiryTag } from "../kit.js";

// ---- The vendor's document vault (a pane in Company profile): each
// required/optional document with its verification status, and an
// Upload / Replace button. Re-uploading resets a document to Pending.
// "Other" documents (asked for by a catalog entry) are listed after the
// standard ones under the name the catalog entry gave them. ----
export async function renderVendorDocuments(container, onChanged = () => {}) {
  try {
    const docs = await api("/vendor-portal/documents");
    const byType = new Map(docs.filter((d) => d.doc_type !== "other").map((d) => [d.doc_type, d]));
    const entries = [
      ...VENDOR_DOC_TYPES.map((t) => ({ key: t.value, type: t.value, label: t.label, mandatory: t.mandatory, accept: acceptFor(t), doc: byType.get(t.value) })),
      ...docs
        .filter((d) => d.doc_type === "other")
        .map((d) => ({ key: "other:" + d.custom_label, type: "other", label: d.custom_label, mandatory: false, accept: ".pdf,.jpg,.jpeg,.png", doc: d, custom: true })),
    ];
    container.innerHTML = `<div class="ep-pane">
      <div class="ep-pane-head"><span>Document vault</span><span class="ep-k">PDF, JPG or PNG · max 10 MB · an expired document suspends bidding until renewed</span></div>
      <table class="ep-table">${th("Document", "File", "Valid till", "Status", "")}<tbody>${entries
        .map((e, i) => {
          const d = e.doc;
          return `<tr>
          <td class="ep-cell" style="font-weight:600">${esc(e.label)}<div>${e.custom ? tag("Requested by a catalog entry") : tag(e.mandatory ? "Required" : "Optional", e.mandatory ? "att" : "")}</div></td>
          <td class="ep-cell" style="font-size:12px">${
            d ? `<span class="ep-mono">${esc(d.original_filename)}</span><div class="ep-sub">${(d.size_bytes / 1024).toFixed(0)} KB · uploaded ${fmtDate(d.uploaded_at)} · <a href="#" data-view="${d.id}">View</a></div>` : '<span class="ep-sub">Not uploaded</span>'
          }</td>
          <td class="ep-cell" style="font-size:12.5px">${d && d.valid_till ? `${fmtDate(d.valid_till)}<div>${expiryTag(d)}</div>` : '<span class="ep-sub">—</span>'}</td>
          <td class="ep-cell">${d ? stateTag(d.status) : tag("Missing", e.mandatory ? "att" : "")}${d && d.status === "rejected" && d.rejection_reason ? `<div class="ep-sub" style="color:#ae1800">${esc(d.rejection_reason)}</div>` : ""}</td>
          <td class="ep-cell" style="text-align:right">
            <input class="input" type="date" data-date="${i}" value="${d?.valid_till || ""}" title="Valid till (only if it expires) — set before uploading" style="width:150px;display:inline-block;margin-right:6px">
            <button class="ep-b" data-upload="${i}">${d ? "Replace" : "Upload"}</button>
            <input type="file" accept="${e.accept}" hidden data-input="${i}">
          </td></tr>`;
        })
        .join("")}</tbody></table>
      <div id="vendor-documents-result" class="result"></div>
    </div>`;
    wire(container, entries, onChanged);
  } catch (err) {
    container.innerHTML = `<div class="result err">Could not load documents: ${esc(err.message)}</div>`;
  }
}

function wire(container, entries, onChanged) {
  const result = container.querySelector("#vendor-documents-result");
  container.querySelectorAll("[data-upload]").forEach((b) => {
    const entry = entries[Number(b.dataset.upload)];
    const input = container.querySelector(`[data-input="${b.dataset.upload}"]`);
    b.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      if (!input.files[0]) return;
      const formData = new FormData();
      formData.append("doc_type", entry.type);
      if (entry.custom) formData.append("custom_label", entry.label);
      formData.append("file", input.files[0]);
      const validTill = container.querySelector(`[data-date="${b.dataset.upload}"]`).value;
      if (validTill) formData.append("valid_till", validTill);
      try {
        // no JSON Content-Type: fetch sets the multipart boundary itself
        await api("/vendor-portal/documents", { method: "POST", body: formData });
        renderVendorDocuments(container, onChanged);
        onChanged();
      } catch (err) {
        showResult(result, "Could not upload: " + err.message, false);
      }
    });
  });
  container.querySelectorAll("[data-view]").forEach((a) =>
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(API_BASE + `/vendor-portal/documents/${a.dataset.view}/download`, { headers: apiHeaders() });
        if (!res.ok) throw new Error("Could not open document");
        window.open(URL.createObjectURL(await res.blob()), "_blank");
      } catch (err) {
        showResult(result, err.message, false);
      }
    })
  );
}
