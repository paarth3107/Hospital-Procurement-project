import { esc, fmtDate } from "../../kit.js";
import { switchView } from "../../nav.js";
import { kpiStrip as kpiTiles } from "./kpi.js";
import { donut } from "../../charts.js";
import { icon } from "../../icons.js";
import { openTenderReview } from "../approvalsPage.js";
import { openTenderAward } from "../awards/awardsPage.js";
import { actionQueue, wireActionQueue } from "./actionQueue.js";
import { renderTenderProgressCard } from "./tenderProgressCard.js";

// ---- Approving Authority's own dashboard (product decision, 2026-10-07 --
// mirrors the Procurement Officer's, see officerDashboard.js). A pipeline
// built only from the two gates this role decides:
//   Pending E-Tender Approval -> (Published, tracking) -> Awaiting your L1 decision
// "Ready for L1 recommendation" is kept as a tracking-only stage (the
// Officer's job, nothing for this role to do yet) the same way the Officer's
// own dashboard tracks "Awaiting L1 approval" without being able to act on
// it. Draft tenders are the Officer's job entirely and don't appear here. ----

// Each card jumps to where that work actually happens: Pending approval ->
// E-Tender Approval inbox, Awaiting your decision -> L1 Award.
function kpiStrip(a) {
  return kpiTiles([
    ["Pending E-Tender Approval", a.pending_approval_count, "needs your decision", "approvals", "clock", "warning"],
    ["Live tenders", a.live_count, "bidding open", null, "activity", "success"],
    ["Ready to recommend", a.ready_to_recommend_lines, `${a.ready_to_recommend_count} tender(s) · the Officer's job`, null, "award", "info"],
    ["Awaiting your decision", a.awaiting_decision_lines, `${a.awaiting_decision_count} tender(s)`, "awards", "check-square", "primary"],
  ]);
}

// Stage rows of the tracker: [label, icon, tone, note, tender count]. Every
// stage counts tenders; the lines behind them are in the note and the table.
function stages(a) {
  return [
    ["Pending E-Tender Approval", "clock", "warning", "needs your decision", a.pending_approval_count],
    ["Published — bidding open", "activity", "success", "bidding open", a.live_count],
    ["Ready for L1 recommendation", "file-text", "info", `${a.ready_to_recommend_lines} line(s) — the Officer's job`, a.ready_to_recommend_count],
    ["Awaiting your L1 decision", "check-square", "primary", `${a.awaiting_decision_lines} line(s) waiting on you`, a.awaiting_decision_count],
  ];
}

// Vuexy-style support tracker: a donut of where the work sits, with each stage listed beside it.
function tracker(a) {
  const rows = stages(a)
    .map(
      ([label, ic, tone, note, count]) => `<div class="d-flex items-center gap-12px">
        <span class="ep-kpi-icon tone-${tone}">${icon(ic, 20)}</span>
        <div class="flex-1 minw-0"><div class="fw-600">${esc(label)}</div><div class="ep-sub">${esc(note)}</div></div>
        <span class="fw-800 fs-16px">${count}</span>
      </div>`
    )
    .join("");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Procurement Pipeline</span><span class="ep-k">where your decisions sit, now</span></div>
    <div class="ep-pane-pad d-flex flex-wrap gap-24px items-center">
      <div id="aa-stage-chart" class="flex-1 minw-0"></div>
      <div class="d-flex flex-col gap-16px flex-1 minw-0">${rows}</div>
    </div>
  </div>`;
}

// What's happening on a tender, in one line: why it's still Pending Approval,
// or bidding status plus what's left to decide while it's Published.
function tenderSubtitle(t) {
  const parts = [`${t.lines_total} line item(s)`];
  if (t.status === "pending_approval") parts.push(t.needs_your_approval ? "needs your decision" : `waiting on tier ${t.required_tier}`);
  else if (t.status === "published") {
    const due = t.bid_due_date ? new Date(t.bid_due_date) : null;
    const closed = due && due <= new Date();
    parts.push(`${t.bids_received} bid(s)${due ? `, ${closed ? "closed" : "closes"} ${fmtDate(t.bid_due_date)}` : ""}`);
    if (t.lines_ready_to_recommend) parts.push(`${t.lines_ready_to_recommend} ready for recommendation`);
    if (t.lines_awaiting_decision) parts.push(`${t.lines_awaiting_decision} awaiting your decision`);
  }
  return parts.join(" · ");
}

export function renderApprovingAuthorityDashboard(root, s) {
  const a = s.approving_authority;
  const queue = actionQueue(s);
  root.innerHTML = `<div class="d-flex flex-col gap-22px">
    ${kpiStrip(a)}
    ${tracker(a)}
    <div class="ep-grid grid-cols-1-45fr-1fr">${queue.html}<div class="ep-pane" id="aa-tenders-pane"></div></div>
  </div>`;
  wireActionQueue(root, queue);
  drawStageChart(a);
  root.querySelectorAll(".ep-kpi[data-view]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  // Pending Approval opens the review, Published opens the award stage.
  const byId = new Map(a.tenders.map((t) => [t.id, t]));
  renderTenderProgressCard(root, "aa-tenders-pane", a.tenders, tenderSubtitle, (id) => {
    if (byId.get(id)?.status === "pending_approval") openTenderReview(id);
    else openTenderAward(id);
  });
}

function drawStageChart(a) {
  const el = document.getElementById("aa-stage-chart");
  if (!el) return;
  donut(el, {
    labels: stages(a).map(([label]) => label),
    series: stages(a).map(([, , , , count]) => count),
    pickColors: (p) => [p.warning, p.success, p.info, p.primary],
    height: 240,
  });
}
