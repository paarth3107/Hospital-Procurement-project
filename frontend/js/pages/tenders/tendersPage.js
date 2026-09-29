import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, stateTag, th, emptyRow, fmtDateTime } from "../../kit.js";
import { initTenderForm, openTenderForm, closeTenderForm, isFormOpen } from "./tenderForm.js";

// ---- Tenders: the list, with "+ New tender" and Manage opening the editor
// form (tenderForm.js) below it. ----
const root = () => document.getElementById("tender-list-root");
const resultEl = () => document.getElementById("tender-result");

const TYPE_LABEL = { rfq: "RFQ", rfp: "RFP", rate_contract: "Rate contract" };

// Awarded / No award are done -- nothing left to act on. Kept out of the
// list by default (they pile up forever otherwise); a checkbox reveals them
// again without a refetch.
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);
let allTenders = [];
let showClosed = false;

function render() {
  const closedCount = allTenders.filter((t) => CLOSED_TENDER_STATUSES.has(t.status)).length;
  const tenders = showClosed ? allTenders : allTenders.filter((t) => !CLOSED_TENDER_STATUSES.has(t.status));
  root().innerHTML = `<div class="ep-pane">
    <div class="ep-pane-head"><span>Tenders</span>
      <div style="display:flex;align-items:center;gap:14px">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;text-transform:none;letter-spacing:0;color:rgba(32,30,29,.7)">
          <input type="checkbox" id="show-closed-tenders" ${showClosed ? "checked" : ""}> Show closed/awarded (${closedCount})
        </label>
        <button class="ep-b" data-v="p" id="add-tender-btn">+ New tender</button>
      </div>
    </div>
    <table class="ep-table">${th("ID", "Title", "Type", "Status", "Bids close", "Round", "")}<tbody>${
      tenders.length
        ? tenders
            .map(
              (t) => `<tr>
                <td class="ep-cell ep-mono" style="font-size:12px">#${t.id}</td>
                <td class="ep-cell"><div style="font-weight:600">${esc(t.title)}</div><div class="ep-sub">${esc(t.department || "")}</div></td>
                <td class="ep-cell">${esc(TYPE_LABEL[t.tender_type] || t.tender_type)}</td>
                <td class="ep-cell">${stateTag(t.status)}</td>
                <td class="ep-cell" style="font-size:12.5px">${fmtDateTime(t.bid_due_date)}</td>
                <td class="ep-cell">${t.round_number}</td>
                <td class="ep-cell" style="text-align:right"><button class="ep-b" data-manage="${t.id}">Manage</button></td>
              </tr>`
            )
            .join("")
        : emptyRow(7, showClosed ? "No tenders yet." : "No open tenders. Closed/awarded tenders are hidden -- tick the box above to see them.")
    }</tbody></table>
  </div>`;
  root().querySelector("#add-tender-btn").addEventListener("click", () => (isFormOpen() ? closeTenderForm() : openTenderForm(null)));
  root().querySelector("#show-closed-tenders").addEventListener("change", (e) => {
    showClosed = e.target.checked;
    render();
  });
  root().querySelectorAll("[data-manage]").forEach((b) => b.addEventListener("click", () => openTenderById(b.dataset.manage)));
}

// Opens a specific tender's editor directly -- used by the Manage button here
// and by other pages (e.g. the Officer's dashboard) navigating in from a task.
export async function openTenderById(id) {
  try {
    openTenderForm(await api(`/tenders/${id}`));
  } catch (err) {
    showResult(resultEl(), "Could not load tender: " + err.message, false);
  }
}

export async function loadTenders() {
  try {
    allTenders = await api("/tenders");
    render();
  } catch (err) {
    showResult(resultEl(), "Could not load tenders: " + err.message, false);
  }
}

initTenderForm({ onTendersChanged: loadTenders });
