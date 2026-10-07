import { esc, fmtDate } from "../../kit.js";
import { switchView } from "../../nav.js";
import { kpiStrip as kpiTiles } from "./kpi.js";
import { donut } from "../../charts.js";
import { icon } from "../../icons.js";
import { openTenderById } from "../tenders/tendersPage.js";
import { actionQueue, wireActionQueue } from "./actionQueue.js";
import { renderTenderProgressCard } from "./tenderProgressCard.js";

// ---- Procurement Officer's own dashboard (product decision, 2026-09-29 --
// the spec has no dashboard requirements). A tender-lifecycle pipeline built
// only from stages this role drives or is directly waiting on:
//   Draft -> Pending E-Tender Approval -> Published (bidding open)
//   -> Ready to recommend -> Awaiting L1 approval
// Deliberately excludes Category Manager's stages (vendor registration,
// mapping, rating refresh) and "technical evaluation in progress" -- the
// Officer has nothing to do while that's running; a line simply appears in
// "Ready to recommend" once it closes. "Awaiting L1 approval" stays as a
// tracking-only stage (not phrased as an action): there is nothing further
// for the Officer to do once a recommendation is approved -- the tender
// finalizes on its own. It's kept visible only so the Officer knows what's
// still out for a decision, and it folds back into "Ready to recommend" if
// the Approving Authority sends it back instead. ----

// Each card jumps to where that work actually happens: Draft -> Tenders (to
// keep editing/submit it), Pending approval / Live -> Bid evaluation (where
// their progress is tracked), Ready to recommend -> L1 award.
function kpiStrip(o) {
  return kpiTiles([
    ["Draft tenders", o.draft_count, "not yet submitted for approval", "tenders", "file-text", "primary"],
    ["Pending approval", o.pending_approval_count, "sent, waiting on the Approving Authority", "evaluation", "clock", "warning"],
    ["Live tenders", o.live_count, o.awaiting_evaluation_close_count ? `bidding open · ${o.awaiting_evaluation_close_count} more closed, awaiting evaluation` : "bidding open", "evaluation", "activity", "success"],
    ["Ready to recommend", o.ready_to_recommend_lines, `${o.ready_to_recommend_count} tender(s)`, "awards", "award", "info"],
  ]);
}

// Stage rows of the tracker: [label, icon, tone, note, tender count]. Every
// stage counts tenders; the lines behind them are in the note and the table.
function stages(o) {
  return [
    ["Draft", "file-text", "primary", "not yet submitted for approval", o.draft_count],
    ["Pending E-Tender Approval", "clock", "warning", "sent, waiting on the Approving Authority", o.pending_approval_count],
    [
      "Published — bidding open",
      "activity",
      "success",
      o.awaiting_evaluation_close_count ? `${o.awaiting_evaluation_close_count} more closed, awaiting evaluation (Category Manager)` : "accepting bids",
      o.live_count,
    ],
    ["Ready to recommend", "award", "info", `${o.ready_to_recommend_lines} line(s) ready to recommend`, o.ready_to_recommend_count],
    ["Awaiting L1 approval", "check-square", "primary", `${o.awaiting_decision_lines} line(s) sent for approval`, o.awaiting_decision_count],
  ];
}

// Vuexy-style support tracker: a donut of where the work sits, with each stage listed beside it.
function tracker(o) {
  const rows = stages(o)
    .map(
      ([label, ic, tone, note, count]) => `<div class="d-flex items-center gap-12px">
        <span class="ep-kpi-icon tone-${tone}">${icon(ic, 20)}</span>
        <div class="flex-1 minw-0"><div class="fw-600">${esc(label)}</div><div class="ep-sub">${esc(note)}</div></div>
        <span class="fw-800 fs-16px">${count}</span>
      </div>`
    )
    .join("");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Procurement pipeline</span><span class="ep-k">where your work sits, now</span></div>
    <div class="ep-pane-pad d-flex flex-wrap gap-24px items-center">
      <div id="officer-stage-chart" class="flex-1 minw-0"></div>
      <div class="d-flex flex-col gap-16px flex-1 minw-0">${rows}</div>
    </div>
  </div>`;
}

// What's happening on a tender, in one line: bidding status while it's live,
// otherwise why it isn't -- draft, pending approval, or what's left to decide.
function tenderSubtitle(t) {
  const parts = [`${t.lines_total} line item(s)`];
  if (t.status === "draft") parts.push("not yet submitted");
  else if (t.status === "pending_approval") parts.push("waiting on the Approving Authority");
  else if (t.status === "published") {
    const due = t.bid_due_date ? new Date(t.bid_due_date) : null;
    const closed = due && due <= new Date();
    parts.push(`${t.bids_received} bid(s)${due ? `, ${closed ? "closed" : "closes"} ${fmtDate(t.bid_due_date)}` : ""}`);
    if (t.lines_ready_to_recommend) parts.push(`${t.lines_ready_to_recommend} to recommend`);
    if (t.lines_awaiting_decision) parts.push(`${t.lines_awaiting_decision} awaiting approval`);
  }
  return parts.join(" · ");
}

export function renderOfficerDashboard(root, s) {
  const o = s.officer;
  const queue = actionQueue(s);
  root.innerHTML = `<div class="d-flex flex-col gap-22px">
    ${kpiStrip(o)}
    ${tracker(o)}
    <div class="ep-grid grid-cols-1-45fr-1fr">${queue.html}<div class="ep-pane" id="officer-tenders-pane"></div></div>
  </div>`;
  wireActionQueue(root, queue);
  drawStageChart(o);
  root.querySelectorAll(".ep-kpi[data-view]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  renderTenderProgressCard(root, "officer-tenders-pane", o.tenders, tenderSubtitle, (id) => {
    switchView("tenders");
    openTenderById(id);
  });
}

function drawStageChart(o) {
  const el = document.getElementById("officer-stage-chart");
  if (!el) return;
  donut(el, {
    labels: stages(o).map(([label]) => label),
    series: stages(o).map(([, , , , count]) => count),
    pickColors: (p) => [p.primary, p.warning, p.success, p.info, p.muted],
    height: 240,
  });
}
