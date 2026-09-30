import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, kicker, fmtDateTime } from "../../kit.js";
import { lineBlockHtml, wireLineBlock } from "./lineDetail.js";

// One tender's evaluation screen (2026-10-01, user-directed): every published
// line of the tender together, one screen -- mirrors the Awards and
// E-Tender-Approval screens' own tender-grouped layout. A single call
// (GET /evaluation/tenders/{id}) already returns every line's full detail, so
// this is a pure render + per-line wiring, no per-line fetch.
export async function renderTenderEvaluation(container, tenderId, { onBack, resultEl }) {
  let detail;
  try {
    detail = await api(`/evaluation/tenders/${tenderId}`);
  } catch (err) {
    showResult(resultEl, err.message, false);
    return;
  }
  const reload = () => renderTenderEvaluation(container, tenderId, { onBack, resultEl });

  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    <div><button class="ep-b" id="ev-back">← All tenders</button></div>
    <div class="ep-pane ep-pane-pad" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">${kicker(`Tender #${detail.tender_id} · ${detail.tender_type.toUpperCase()} · ${detail.facility_name}`)}
        <h4 style="margin:4px 0 3px;font-size:21px">${esc(detail.tender_title)}</h4><div class="ep-sub">${detail.lines.length} line(s)</div></div>
      <div>${kicker("Bids close")}<div style="font-weight:700;margin-top:3px">${esc(fmtDateTime(detail.bid_due_date))}</div></div>
    </div>
    ${detail.lines.map((l) => `<div class="ep-pane" data-line-block="${l.summary.line_item_id}">${lineBlockHtml(l)}</div>`).join("")}
  </div>`;

  container.querySelector("#ev-back").addEventListener("click", onBack);
  for (const l of detail.lines) {
    const lineContainer = container.querySelector(`[data-line-block="${l.summary.line_item_id}"]`);
    wireLineBlock(lineContainer, l.summary.line_item_id, l, { onReload: reload, resultEl });
  }
}
