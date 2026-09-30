import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, th, emptyRow, fmtDateTime, pageSlice, paginationBar, wirePagination } from "../../kit.js";
import { renderTenderEvaluation } from "./tenderEvaluation.js";

// ---- Bid evaluation (Officer, Category Manager, Procurement Admin), grouped
// by tender (2026-10-01, user-directed: mirrors Awards/E-Tender-Approval's
// own tender-grouped layout instead of a flat cross-tender line list). Open a
// tender to see every one of its published lines together, track
// submissions and, after the due date, evaluate the technical envelope. ----
const root = () => document.getElementById("evaluation-root");
const resultEl = () => document.getElementById("evaluation-result");

let selected = null;

// Awarded / No award are done -- nothing left to act on. Kept out of the list
// by default (they pile up forever otherwise); a checkbox reveals them again
// without a refetch (same pattern as the Tenders tab and the Awards screen).
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);
let allTenders = [];
let showClosed = false;
let page = 0;

function render() {
  const closedCount = allTenders.filter((t) => CLOSED_TENDER_STATUSES.has(t.tender_status)).length;
  const filtered = showClosed ? allTenders : allTenders.filter((t) => !CLOSED_TENDER_STATUSES.has(t.tender_status));
  const { pageItems: tenders, totalPages, page: clamped } = pageSlice(filtered, page);
  page = clamped;
  const rows = tenders.length
    ? tenders
        .map(
          (t) => `<tr>
            <td class="ep-cell"><div style="font-weight:700">#${t.tender_id}</div><div class="ep-sub">${esc(t.tender_title)}</div></td>
            <td class="ep-cell" style="font-size:12.5px">${esc(t.facility_name)}</td>
            <td class="ep-cell" style="font-size:12.5px">${esc(fmtDateTime(t.bid_due_date))}</td>
            <td class="ep-cell" style="font-size:12.5px">${t.line_count} line(s)<div class="ep-sub">${t.open_count ? `${t.open_count} still open` : "all closed"}</div></td>
            <td class="ep-cell" style="font-size:12.5px">${t.submitted_count} submitted<div class="ep-sub">${t.evaluated_count} evaluated</div></td>
            <td class="ep-cell" style="text-align:right"><button class="ep-b" data-tender="${t.tender_id}">Open</button></td></tr>`
        )
        .join("")
    : emptyRow(6, showClosed ? "No published tenders yet." : "Nothing in progress. Closed tenders are hidden -- tick the box above to see them.");
  root().innerHTML = `<div class="ep-pane"><div class="ep-pane-head"><span>Tenders to Evaluate</span>
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;text-transform:none;letter-spacing:0;color:rgba(32,30,29,.7)">
      <input type="checkbox" id="show-closed-eval" ${showClosed ? "checked" : ""}> Show closed/awarded (${closedCount})
    </label></div>
    <table class="ep-table">${th("Tender", "Facility", "Bids close", "Lines", "Bids", "")}<tbody>${rows}</tbody></table>
    ${paginationBar(page, totalPages, "eval-prev", "eval-next")}</div>`;
  root()
    .querySelector("#show-closed-eval")
    .addEventListener("change", (e) => {
      showClosed = e.target.checked;
      page = 0;
      render();
    });
  wirePagination(root(), "eval-prev", "eval-next", page, (p) => {
    page = p;
    render();
  });
  root()
    .querySelectorAll("[data-tender]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        selected = Number(b.dataset.tender);
        showTender();
      })
    );
}

async function showList() {
  selected = null;
  try {
    allTenders = await api("/evaluation/tenders");
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load bid evaluation: " + err.message, false);
  }
}

function showTender() {
  return renderTenderEvaluation(root(), selected, { onBack: showList, resultEl: resultEl() });
}

export const loadEvaluation = () => (selected ? showTender() : showList());
