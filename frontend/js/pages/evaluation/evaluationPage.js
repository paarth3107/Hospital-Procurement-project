import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, tag, th, emptyRow, fmtDateTime } from "../../kit.js";
import { renderLineDetail } from "./lineDetail.js";

// ---- Bid evaluation (Officer, Category Manager, Procurement Admin): every
// published line with its bidding stage. Open a line to track submissions
// and, after the due date, evaluate the technical envelope. ----
const root = () => document.getElementById("evaluation-root");
const resultEl = () => document.getElementById("evaluation-result");

const PHASE = {
  bidding_open: ["Bidding open", "att"],
  technical_evaluation: ["Technical evaluation", "esc"],
  technical_closed: ["Technical closed", "pos"],
};

let selected = null;

async function showList() {
  selected = null;
  try {
    const lines = await api("/evaluation/lines");
    const rows = lines.length
      ? lines
          .map((l) => {
            const [label, tone] = PHASE[l.phase];
            return `<tr>
              <td class="ep-cell"><div style="font-weight:700">#${l.tender_id}</div><div class="ep-sub">${esc(l.tender_title)}</div></td>
              <td class="ep-cell"><div style="font-weight:600">${esc(l.product_name)}</div><div class="ep-sub">${l.qty} · ${esc(l.procurement_type)}${l.technical_eval_method !== "qualify_disqualify" ? " · scored" : ""}</div></td>
              <td class="ep-cell" style="font-size:12.5px">${esc(fmtDateTime(l.bid_due_date))}</td>
              <td class="ep-cell">${tag(label, tone)}</td>
              <td class="ep-cell" style="font-size:12.5px">${l.submitted_count} of ${l.invited_count} submitted${l.phase !== "bidding_open" ? `<div class="ep-sub">${l.evaluated_count} evaluated</div>` : ""}</td>
              <td class="ep-cell" style="text-align:right"><button class="ep-b" data-line="${l.line_item_id}">Open</button></td></tr>`;
          })
          .join("")
      : emptyRow(6, "No published tender lines yet.");
    root().innerHTML = `<div class="ep-pane"><div class="ep-pane-head"><span>Published lines</span><span class="ep-k">${lines.length} lines</span></div>
      <table class="ep-table">${th("Tender", "Line item", "Bids close", "Stage", "Bids", "")}<tbody>${rows}</tbody></table></div>`;
    root().querySelectorAll("[data-line]").forEach((b) =>
      b.addEventListener("click", () => {
        selected = Number(b.dataset.line);
        showLine();
      })
    );
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load bid evaluation: " + err.message, false);
  }
}

function showLine() {
  return renderLineDetail(root(), selected, { onBack: showList, onReload: showLine, resultEl: resultEl() });
}

export const loadEvaluation = () => (selected ? showLine() : showList());
