import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { esc, fmtDate } from "../kit.js";
import { icon } from "../icons.js";
import { donut } from "../charts.js";
import { actionQueue, wireActionQueue } from "./dashboard/actionQueue.js";
import { renderOfficerDashboard } from "./dashboard/officerDashboard.js";
import { renderApprovingAuthorityDashboard } from "./dashboard/approvingAuthorityDashboard.js";
import { renderCategoryManagerDashboard } from "./dashboard/categoryManagerDashboard.js";
import { vendorBase, drawVendorBase } from "./dashboard/vendorBase.js";
import { kpiStrip as kpiTiles } from "./dashboard/kpi.js";

// ---- Staff dashboard: the prototype's command-centre layout, fed by
// GET /dashboard/stats (real counts only). Role-specific dashboards live
// under dashboard/ -- Procurement Officer (2026-09-29), Category Manager /
// Procurement Admin (2026-09-30) and Approving Authority (2026-10-07) were
// rebuilt into their own views; System Admin still shares this generic view
// below (it has every tab, so no one pipeline fits it). ----

function kpiStrip(s) {
  const v = s.vendors_by_status;
  return kpiTiles([
    ["Live tenders", s.open_tenders_count, s.next_bid_close ? `next bid close ${fmtDate(s.next_bid_close)}` : "none open for bidding", null, "file-text", "primary"],
    ["Active vendors", v.active || 0, `${v.suspended || 0} suspended · ${(v.pending_verification || 0) + (v.info_requested || 0)} pending`, null, "users", "success"],
    ["Bids submitted", s.bids_submitted_count, "prices masked from staff", null, "check-square", "info"],
    ["Awaiting your approval", s.pending_approval_count, "e-tender approval", null, "clock", "warning"],
  ]);
}

// Vuexy-style pipeline card (2026-10-09) -- same donut + icon-row tracker
// component as the Procurement Officer's and Category Manager's own
// dashboards (2026-09-29/2026-10-07), not the plain list I tried first.
// Each stage is the *current backlog* sitting at that step, the same thing
// their stage counts mean (e.g. the Officer's "pending_approval_count" is
// tenders waiting right now, not a cumulative total) -- here: vendors
// awaiting KYC, mapping requests awaiting decision, ratings overdue for
// manual refresh, tenders awaiting E-Tender Approval, and lines whose
// bidding closed but technical evaluation isn't done. All five are already
// top-level fields on the generic /dashboard/stats payload every role gets
// (stale_ratings and eval_workload in particular -- unused by the old
// pipeline() despite being right there), so this needed no backend change.
function stages(s) {
  return [
    ["Vendor registration", "users", "primary", "awaiting KYC decision", s.vendors_pending_count],
    ["Master & mapping", "layers", "info", "mapping requests awaiting decision", s.mappings_pending_count],
    ["Rating refresh", "star", "warning", "manual update overdue (90+ days)", s.stale_ratings.length],
    ["Tender & publishing", "clock", "danger", "tenders awaiting E-Tender Approval", s.pending_approval_count],
    ["Bid → L1 → PO", "check-square", "success", "line(s) ready for technical evaluation", s.eval_workload.length],
  ];
}

function tracker(s) {
  const rows = stages(s)
    .map(
      ([label, ic, tone, note, count]) => `<div class="d-flex items-center gap-12px">
        <span class="ep-kpi-icon tone-${tone}">${icon(ic, 20)}</span>
        <div class="flex-1 minw-0"><div class="fw-600">${esc(label)}</div><div class="ep-sub">${esc(note)}</div></div>
        <span class="fw-800 fs-16px">${count}</span>
      </div>`
    )
    .join("");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Procurement Pipeline</span><span class="ep-k">where the system-wide backlog sits, now</span></div>
    <div class="ep-pane-pad d-flex flex-wrap gap-24px items-center">
      <div id="sa-stage-chart" class="flex-1 minw-0"></div>
      <div class="d-flex flex-col gap-16px flex-1 minw-0">${rows}</div>
    </div>
  </div>`;
}

function drawStageChart(s) {
  const el = document.getElementById("sa-stage-chart");
  if (!el) return;
  donut(el, {
    labels: stages(s).map(([label]) => label),
    series: stages(s).map(([, , , , count]) => count),
    pickColors: (p) => [p.primary, p.info, p.warning, p.danger, p.success],
    height: 240,
  });
}

export async function loadDashboard() {
  const root = document.getElementById("dashboard-root");
  const resultEl = document.getElementById("dashboard-result");
  try {
    const s = await api("/dashboard/stats");
    if (state.user?.role === "procurement_officer" && s.officer) {
      renderOfficerDashboard(root, s);
      resultEl.textContent = "";
      return;
    }
    if (state.user?.role === "category_manager" || state.user?.role === "procurement_admin") {
      renderCategoryManagerDashboard(root, s);
      resultEl.textContent = "";
      return;
    }
    if (state.user?.role === "approving_authority" && s.approving_authority) {
      renderApprovingAuthorityDashboard(root, s);
      resultEl.textContent = "";
      return;
    }
    const queue = actionQueue(s);
    root.innerHTML = `<div class="d-flex flex-col gap-22px">
      ${kpiStrip(s)}
      ${tracker(s)}
      <div class="ep-grid grid-cols-1-45fr-1fr">${queue.html}${vendorBase(s)}</div>
    </div>`;
    wireActionQueue(root, queue);
    drawVendorBase(s);
    drawStageChart(s);
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}
