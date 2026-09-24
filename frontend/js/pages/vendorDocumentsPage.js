import { API_BASE, api, apiHeaders } from "../api.js";
import { showResult } from "../ui.js";
import { VENDOR_DOC_TYPES } from "../constants.js";
import { esc, tag, stateTag, th, fmtDate } from "../kit.js";

// ---- The vendor's document vault (a pane in Company profile): each
// required/optional document with its verification status, and an
// Upload / Replace button. Re-uploading resets a document to Pending. ----
export async function renderVendorDocuments(container) {
  try {
    const docs = await api("/vendor-portal/documents");
    const byType = new Map(docs.map((d) => [d.doc_type, d]));
    container.innerHTML = `<div class="ep-pane">
      <div class="ep-pane-head"><span>Document vault</span><span class="ep-k">PDF, JPG or PNG · max 10 MB</span></div>
      <table class="ep-table">${th("Document", "File", "Status", "")}<tbody>${VENDOR_DOC_TYPES.map((t) => {
        const d = byType.get(t.value);
        return `<tr>
          <td class="ep-cell" style="font-weight:600">${t.label}<div>${tag(t.mandatory ? "Required" : "Optional", t.mandatory ? "att" : "")}</div></td>
          <td class="ep-cell" style="font-size:12px">${
            d ? `<span class="ep-mono">${esc(d.original_filename)}</span><div class="ep-sub">${(d.size_bytes / 1024).toFixed(0)} KB · uploaded ${fmtDate(d.uploaded_at)} · <a href="#" data-view="${d.id}">View</a></div>` : '<span class="ep-sub">Not uploaded</span>'
          }</td>
          <td class="ep-cell">${d ? stateTag(d.status) : tag("Missing", t.mandatory ? "att" : "")}${d && d.status === "rejected" && d.rejection_reason ? `<div class="ep-sub" style="color:#ae1800">${esc(d.rejection_reason)}</div>` : ""}</td>
          <td class="ep-cell" style="text-align:right">
            <button class="ep-b" data-upload="${t.value}">${d ? "Replace" : "Upload"}</button>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden data-input="${t.value}">
          </td></tr>`;
      }).join("")}</tbody></table>
      <div id="vendor-documents-result" class="result"></div>
    </div>`;
    wire(container);
  } catch (err) {
    container.innerHTML = `<div class="result err">Could not load documents: ${esc(err.message)}</div>`;
  }
}

function wire(container) {
  const result = container.querySelector("#vendor-documents-result");
  container.querySelectorAll("[data-upload]").forEach((b) => {
    const input = container.querySelector(`[data-input="${b.dataset.upload}"]`);
    b.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      if (!input.files[0]) return;
      const formData = new FormData();
      formData.append("doc_type", b.dataset.upload);
      formData.append("file", input.files[0]);
      try {
        // no JSON Content-Type: fetch sets the multipart boundary itself
        await api("/vendor-portal/documents", { method: "POST", body: formData });
        renderVendorDocuments(container);
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
