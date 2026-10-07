import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { esc, kicker, fmtDate } from "../kit.js";
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

function pipeline(s) {
  const v = s.vendors_by_status;
  const stages = [
    ["Vendor registration", `${v.active || 0} active · ${(v.pending_verification || 0) + (v.info_requested || 0)} in queue`, (v.active || 0) > 0],
    ["Master & mapping", `${s.catalog_entries_count} entries · ${s.mappings_approved_count} mappings`, s.catalog_entries_count > 0 && s.mappings_approved_count > 0],
    ["Rating refresh", s.last_rating_update ? `last manual update ${fmtDate(s.last_rating_update)}` : "no manual entries yet", !!s.last_rating_update],
    ["Tender & publishing", `${s.lines_published} of ${s.lines_total} live lines published`, s.lines_total > 0 && s.lines_published === s.lines_total],
    ["Bid → L1 → PO", `${s.bids_submitted_count} bid(s) received`, s.bids_submitted_count > 0],
  ];
  return `<div>
    <div class="ep-k mb-9px">Procurement pipeline</div>
    <div class="ep-pipeline">${stages
      .map(
        ([name, note, done], i) => `<div class="ep-stage">
          <div class="d-flex items-center gap-7px">
            <span class="ep-stage-dot ${done ? "ep-stage-dot-on" : "ep-stage-dot-off"}">${i + 1}</span>
            <span class="fs-12-5px fw-800">${esc(name)}</span>
          </div>
          <div class="ep-sub lh-1-4">${esc(note)}</div>
          <div class="ep-stage-bar ${done ? "ep-stage-bar-on" : "ep-stage-bar-off"}"></div>
        </div>`
      )
      .join("")}</div>
  </div>`;
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
      ${pipeline(s)}
      <div class="ep-grid grid-cols-1-45fr-1fr">${queue.html}${vendorBase(s)}</div>
    </div>`;
    wireActionQueue(root, queue);
    drawVendorBase(s);
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}
