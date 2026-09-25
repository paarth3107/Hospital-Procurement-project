import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, tag, th, emptyRow, inr } from "../../kit.js";
import { STATE } from "./awardHelpers.js";
import { renderTenderAward } from "./tenderAward.js";

// ---- L1 award (Module 6-7): tenders whose technical evaluation has closed.
// The Officer recommends per line and submits; the Approving Authority
// decides; when every line is decided the tender is Awarded and the PO data
// files are generated. ----
const root = () => document.getElementById("awards-root");
const resultEl = () => document.getElementById("awards-result");
let selected = null;

async function showList() {
  selected = null;
  try {
    const tenders = await api("/awards/tenders");
    const rows = tenders.length
      ? tenders
          .map((t) => {
            const chips = Object.entries(t.counts)
              .map(([k, n]) => `${n} ${STATE[k] ? STATE[k][0].toLowerCase() : k}`)
              .join(" · ");
            return `<tr>
              <td class="ep-cell"><div style="font-weight:700">#${t.tender_id}</div><div class="ep-sub">${esc(t.title)}</div></td>
              <td class="ep-cell">${t.status === "awarded" ? tag("Awarded", "pos") : t.status === "no_award" ? tag("Nothing awarded", "neg") : tag("In progress", "att")}</td>
              <td class="ep-cell" style="font-size:12.5px">${chips}</td>
              <td class="ep-cell" style="font-size:12.5px">${t.required_tier ? `${inr(t.pending_value)}<div class="ep-sub">tier ${t.required_tier}</div>` : "—"}</td>
              <td class="ep-cell">${t.waiting_for_you ? tag("Waiting for you", "att") : ""}</td>
              <td class="ep-cell" style="text-align:right"><button class="ep-b" data-v="p" data-tender="${t.tender_id}">Open</button></td></tr>`;
          })
          .join("")
      : emptyRow(6, "No tender has reached the award stage yet. It appears here once a line's technical evaluation is closed.");
    root().innerHTML = `<div class="ep-pane"><div class="ep-pane-head"><span>Tenders at the award stage</span><span class="ep-k">${tenders.length}</span></div>
      <table class="ep-table">${th("Tender", "Status", "Lines", "Award value", "", "")}<tbody>${rows}</tbody></table></div>`;
    root().querySelectorAll("[data-tender]").forEach((b) =>
      b.addEventListener("click", () => {
        selected = Number(b.dataset.tender);
        showTender();
      })
    );
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
