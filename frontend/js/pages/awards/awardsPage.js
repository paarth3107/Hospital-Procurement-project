import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, tag, th, emptyRow, inr, pageSlice, paginationBar, wirePagination } from "../../kit.js";
import { STATE } from "./awardHelpers.js";
import { renderTenderAward } from "./tenderAward.js";

// ---- L1 award (Module 6-7): tenders whose technical evaluation has closed.
// The Officer recommends per line and submits; the Approving Authority
// decides; when every line is decided the tender is Awarded and the PO data
// files are generated. ----
const root = () => document.getElementById("awards-root");
const resultEl = () => document.getElementById("awards-result");
let selected = null;

// Awarded / No award are done -- nothing left to act on. Kept out of the
// list by default (they pile up forever otherwise); a checkbox reveals them
// again without a refetch (same pattern as the Tenders tab / vendor's Open
// Invitations, 2026-09-29).
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);
let allTenders = [];
let showClosed = false;
let page = 0;

function render() {
  const closedCount = allTenders.filter((t) => CLOSED_TENDER_STATUSES.has(t.status)).length;
  const filtered = showClosed ? allTenders : allTenders.filter((t) => !CLOSED_TENDER_STATUSES.has(t.status));
  const { pageItems: tenders, totalPages, page: clamped } = pageSlice(filtered, page);
  page = clamped;
  const rows = tenders.length
    ? tenders
        .map((t) => {
          const chips = Object.entries(t.counts)
            .map(([k, n]) => `${n} ${STATE[k] ? STATE[k][0].toLowerCase() : k}`)
            .join(" · ");
          return `<tr>
            <td class="ep-cell"><div class="fw-700">#${t.tender_id}</div><div class="ep-sub">${esc(t.title)}</div></td>
            <td class="ep-cell">${t.status === "awarded" ? tag("Awarded", "pos") : t.status === "no_award" ? tag("Nothing awarded", "neg") : tag("In progress", "att")}</td>
            <td class="ep-cell fs-12-5px">${chips}</td>
            <td class="ep-cell fs-12-5px">${t.required_tier ? `${inr(t.pending_value)}<div class="ep-sub">tier ${t.required_tier}</div>` : "—"}</td>
            <td class="ep-cell">${t.waiting_for_you ? tag("Waiting for you", "att") : ""}</td>
            <td class="ep-cell text-right"><button class="ep-b" data-v="p" data-tender="${t.tender_id}">Open</button></td></tr>`;
        })
        .join("")
    : emptyRow(6, showClosed ? "No tender has reached the award stage yet." : "Nothing in progress. Closed tenders are hidden -- tick the box above to see them.");
  root().innerHTML = `<div class="ep-pane"><div class="ep-pane-head"><span>Tenders At The Award Stage</span>
    <label class="d-flex items-center gap-6px fs-12px fw-400 tt-none ls-0 text-ink-70">
      <input type="checkbox" id="show-closed-awards" ${showClosed ? "checked" : ""}> Show closed/awarded (${closedCount})
    </label></div>
    <table class="ep-table">${th("Tender", "Status", "Lines", "Award value", "", "")}<tbody>${rows}</tbody></table>
    ${paginationBar(page, totalPages, "awards-prev", "awards-next")}</div>`;
  root()
    .querySelector("#show-closed-awards")
    .addEventListener("change", (e) => {
      showClosed = e.target.checked;
      page = 0;
      render();
    });
  wirePagination(root(), "awards-prev", "awards-next", page, (p) => {
    page = p;
    render();
  });
  root().querySelectorAll("[data-tender]").forEach((b) =>
    b.addEventListener("click", () => {
      selected = Number(b.dataset.tender);
      showTender();
    })
  );
}

async function showList() {
  selected = null;
  try {
    allTenders = await api("/awards/tenders");
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load the award stage: " + err.message, false);
  }
}

function showTender() {
  resultEl().textContent = "";
  return renderTenderAward(root(), selected, { onBack: showList, resultEl: resultEl() });
}

export const loadAwards = () => (selected ? showTender() : showList());
