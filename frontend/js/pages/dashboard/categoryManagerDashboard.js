import { esc } from "../../kit.js";
import { switchView } from "../../nav.js";
import { donut } from "../../charts.js";
import { icon } from "../../icons.js";
import { actionQueue, wireActionQueue } from "./actionQueue.js";
import { kpiStrip as kpiTiles } from "./kpi.js";
import { drawVendorBase, vendorBase } from "./vendorBase.js";

// ---- Category Manager / Procurement Admin's own dashboard (one job, per
// CLAUDE.md) -- product decision, 2026-09-30. Replaces the generic
// dashboard's PO-facing numbers (Live tenders / Awaiting your approval /
// Bids submitted aren't this role's job -- it doesn't even have an
// "approvals" tab) with the four queues this role actually runs.
//
// KYC, mapping and rating hygiene stay outside any pipeline: they're
// independent queues running in parallel, not steps of one tender's
// lifecycle. Technical evaluation is different -- it IS a step of a
// tender's lifecycle this role actually owns, so it gets the same
// "Procurement pipeline" tracker the Officer's and Approving Authority's
// dashboards have (2026-10-07), scoped to just that step. ----

function kpiStrip(s) {
  return kpiTiles([
    ["Vendor KYC", s.vendors_pending_count, s.docs_to_verify.length ? `+${s.docs_to_verify.length} vendor(s) with documents to verify` : "new registrations awaiting review", "queue", "user-check", "primary"],
    ["Mapping requests", s.mappings_pending_count, "vendor category / item eligibility", "mappings-requests", "layers", "info"],
    ["Ready for technical evaluation", s.eval_workload.length, "bidding closed, not yet scored", "evaluation", "bar-chart", "success"],
    ["Ratings needing refresh", s.stale_ratings.length, "no manual update in 90+ days", "ratings", "star", "warning"],
  ]);
}

// Stage rows of the tracker: [label, icon, tone, note, count]. Stage 1
// counts tenders (bidding is tender-wide); the other two count lines (a
// tender's lines close technical evaluation independently of each other).
function stages(c) {
  return [
    ["Published — bidding open", "activity", "success", `${c.live_count} tender(s) accepting bids`, c.live_count],
    ["Bidding closed — awaiting evaluation", "bar-chart", "warning", `${c.awaiting_evaluation_count} line(s) ready for you to score`, c.awaiting_evaluation_count],
    ["Technical evaluation closed", "check-square", "info", `${c.evaluated_count} line(s) now with the Officer for recommendation`, c.evaluated_count],
  ];
}

// Vuexy-style support tracker: a donut of where the work sits, with each stage listed beside it.
function tracker(c) {
  const rows = stages(c)
    .map(
      ([label, ic, tone, note, count]) => `<div class="d-flex items-center gap-12px">
        <span class="ep-kpi-icon tone-${tone}">${icon(ic, 20)}</span>
        <div class="flex-1 minw-0"><div class="fw-600">${esc(label)}</div><div class="ep-sub">${esc(note)}</div></div>
        <span class="fw-800 fs-16px">${count}</span>
      </div>`
    )
    .join("");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Procurement Pipeline</span><span class="ep-k">technical evaluation, where it sits now</span></div>
    <div class="ep-pane-pad d-flex flex-wrap gap-24px items-center">
      <div id="cm-stage-chart" class="flex-1 minw-0"></div>
      <div class="d-flex flex-col gap-16px flex-1 minw-0">${rows}</div>
    </div>
  </div>`;
}

export function renderCategoryManagerDashboard(root, s) {
  const c = s.category_manager;
  const queue = actionQueue(s);
  root.innerHTML = `<div class="d-flex flex-col gap-22px">
    ${kpiStrip(s)}
    ${c ? tracker(c) : ""}
    <div class="ep-grid grid-cols-1-45fr-1fr">${queue.html}${vendorBase(s)}</div>
  </div>`;
  wireActionQueue(root, queue);
  root.querySelectorAll(".ep-kpi[data-view]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  drawVendorBase(s);
  if (c) drawStageChart(c);
}

function drawStageChart(c) {
  const el = document.getElementById("cm-stage-chart");
  if (!el) return;
  donut(el, {
    labels: stages(c).map(([label]) => label),
    series: stages(c).map(([, , , , count]) => count),
    pickColors: (p) => [p.success, p.warning, p.info],
    height: 240,
  });
}
