import { API_BASE, api, apiHeaders } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, th, emptyRow, fmtDateTime, inr } from "../../kit.js";

// ---- PO data files (spec 10.3-10.5): one per awarded vendor per tender.
// This system's job ends at the generated file -- download the CSV or XML
// and hand it to the ERP team. Recording the ERP's import outcome and
// re-exporting a corrected file (spec 10.5 points 3-5, 10.7) are out of
// scope for now (user-directed, 2026-09-28). ----
const root = () => document.getElementById("pofiles-root");
const resultEl = () => document.getElementById("pofiles-result");

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

async function load() {
  try {
    const files = await api("/po-files");
    const rows = files.length
      ? files
          .map(
            (f) => `<tr>
              <td class="ep-cell"><div style="font-weight:700">${esc(f.batch_id)}</div><div class="ep-sub">tender #${f.tender_id} · ${esc(f.tender_title)}</div></td>
              <td class="ep-cell">${esc(f.vendor_name)}<div class="ep-sub">${esc(f.vendor_code)}</div></td>
              <td class="ep-cell" style="font-size:12.5px">${f.lines} line(s)<div style="font-weight:600">${inr(f.total_incl_tax)}</div></td>
              <td class="ep-cell" style="font-size:12.5px">${esc(f.approved_by)}<div class="ep-sub">${esc(fmtDateTime(f.generated_at))}</div></td>
              <td class="ep-cell" style="text-align:right;white-space:nowrap">
                <button class="ep-b" data-dl="${f.id}:${esc(f.batch_id)}:csv">CSV</button> <button class="ep-b" data-dl="${f.id}:${esc(f.batch_id)}:xml">XML</button>
              </td></tr>`
          )
          .join("")
      : emptyRow(5, "No PO data files yet. They are generated when an Approving Authority approves the last line of a tender.");
    root().innerHTML = `<div class="ep-pane"><div class="ep-pane-head"><span>PO data files</span><span class="ep-k">${files.length}</span></div>
      <div style="padding:10px 16px" class="hint">This system's job ends at the file. Download it as CSV or XML and hand it to the ERP team. Files carry vendor GSTIN and prices, so only Procurement Admin / Category Manager can download them.</div>
      <table class="ep-table">${th("Batch", "Vendor", "Value", "Approved by", "")}<tbody>${rows}</tbody></table></div>`;
    root().querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => download(...b.dataset.dl.split(":").map((x, i) => (i === 0 ? Number(x) : x)))));
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load PO data files: " + err.message, false);
  }
}

export const loadPoFiles = () => load();
