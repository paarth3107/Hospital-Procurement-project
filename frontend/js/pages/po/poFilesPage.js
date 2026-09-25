import { API_BASE, api, apiHeaders } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, stateTag, th, emptyRow, fmtDateTime, inr } from "../../kit.js";
import { modalPrompt } from "../../modal.js";

// ---- PO data files (spec 10.3-10.5): one per awarded vendor per tender. The
// hospital ERP ingests them: download the CSV or XML, upload it into the ERP,
// then record the result here (the ERP's PO number, or why it failed). A failed
// file can be re-exported as a new version; the old one is kept. ----
const root = () => document.getElementById("pofiles-root");
const resultEl = () => document.getElementById("pofiles-result");
const json = { "Content-Type": "application/json" };

async function download(id, batch, format) {
  try {
    const res = await fetch(`${API_BASE}/po-files/${id}/download?format=${format}`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not download the file");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${batch}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showResult(resultEl(), err.message, false);
  }
}

async function act(fn, message) {
  try {
    await fn();
    await load(message);
  } catch (err) {
    showResult(resultEl(), err.message, false);
  }
}

async function load(message) {
  try {
    const files = await api("/po-files");
    const rows = files.length
      ? files
          .map((f) => {
            const live = f.status === "pending_upload";
            return `<tr>
              <td class="ep-cell"><div style="font-weight:700">${esc(f.batch_id)}</div><div class="ep-sub">tender #${f.tender_id} · ${esc(f.tender_title)}</div></td>
              <td class="ep-cell">${esc(f.vendor_name)}<div class="ep-sub">${esc(f.vendor_code)}</div></td>
              <td class="ep-cell" style="font-size:12.5px">${f.lines} line(s)<div style="font-weight:600">${inr(f.total_incl_tax)}</div></td>
              <td class="ep-cell" style="font-size:12.5px">${esc(f.approved_by)}<div class="ep-sub">${esc(fmtDateTime(f.generated_at))}</div></td>
              <td class="ep-cell">${stateTag(f.status)}${f.erp_po_number ? `<div class="ep-sub">ERP PO ${esc(f.erp_po_number)}</div>` : ""}${f.status_reason ? `<div class="ep-sub" style="max-width:220px">${esc(f.status_reason)}</div>` : ""}</td>
              <td class="ep-cell" style="text-align:right;white-space:nowrap">
                ${f.status !== "superseded" ? `<button class="ep-b" data-dl="${f.id}:${esc(f.batch_id)}:csv">CSV</button> <button class="ep-b" data-dl="${f.id}:${esc(f.batch_id)}:xml">XML</button>` : ""}
                ${live ? ` <button class="ep-b" data-v="p" data-imported="${f.id}">Mark imported</button> <button class="ep-b" data-failed="${f.id}">Import failed</button>` : ""}
                ${f.status === "import_failed" ? ` <button class="ep-b" data-v="p" data-reexport="${f.id}">Re-export</button>` : ""}
              </td></tr>`;
          })
          .join("")
      : emptyRow(6, "No PO data files yet. They are generated when an Approving Authority approves the last line of a tender.");
    root().innerHTML = `<div class="ep-pane"><div class="ep-pane-head"><span>PO data files</span><span class="ep-k">${files.length}</span></div>
      <div style="padding:10px 16px" class="hint">This system's job ends at the file. Download it, load it into the ERP's PO import, then record the outcome here. Files carry vendor GSTIN and prices, so only Procurement Admin / Category Manager can download them.</div>
      <table class="ep-table">${th("Batch", "Vendor", "Value", "Approved by", "Status", "")}<tbody>${rows}</tbody></table></div>`;
    root().querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => download(...b.dataset.dl.split(":").map((x, i) => (i === 0 ? Number(x) : x)))));
    root().querySelectorAll("[data-imported]").forEach((b) =>
      b.addEventListener("click", async () => {
        const n = await modalPrompt("The purchase order number the ERP created:");
        if (n) act(() => api(`/po-files/${b.dataset.imported}/mark-imported`, { method: "POST", headers: json, body: JSON.stringify({ erp_po_number: n }) }), "Marked as imported.");
      })
    );
    root().querySelectorAll("[data-failed]").forEach((b) =>
      b.addEventListener("click", async () => {
        const r = await modalPrompt("Why did the ERP reject the file? (required)");
        if (r) act(() => api(`/po-files/${b.dataset.failed}/mark-failed`, { method: "POST", headers: json, body: JSON.stringify({ reason: r }) }), "Recorded as import failed.");
      })
    );
    root().querySelectorAll("[data-reexport]").forEach((b) =>
      b.addEventListener("click", async () => {
        const r = await modalPrompt("Reason for re-exporting (required). Approved prices and quantities cannot change; only vendor master data is refreshed:");
        if (r) act(() => api(`/po-files/${b.dataset.reexport}/re-export`, { method: "POST", headers: json, body: JSON.stringify({ reason: r }) }), "A new version was generated.");
      })
    );
    if (message) showResult(resultEl(), message, true);
    else resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load PO data files: " + err.message, false);
  }
}

export const loadPoFiles = () => load();
