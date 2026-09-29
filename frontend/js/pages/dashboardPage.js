import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { esc, kicker, fmtDate } from "../kit.js";
import { actionQueue, wireActionQueue } from "./dashboard/actionQueue.js";
import { renderOfficerDashboard } from "./dashboard/officerDashboard.js";

// ---- Staff dashboard: the prototype's command-centre layout, fed by
// GET /dashboard/stats (real counts only). Role-specific dashboards live
// under dashboard/ -- Procurement Officer was rebuilt 2026-09-29 into its own
// tender-lifecycle pipeline (see officerDashboard.js); the other roles still
// share this generic view below until they get the same treatment. ----

function kpiStrip(s) {
  const v = s.vendors_by_status;
  const cells = [
    ["Live tenders", s.open_tenders_count, s.next_bid_close ? `next bid close ${fmtDate(s.next_bid_close)}` : "none open for bidding"],
    ["Active vendors", v.active || 0, `${v.suspended || 0} suspended · ${(v.pending_verification || 0) + (v.info_requested || 0)} pending`],
    ["Bids submitted", s.bids_submitted_count, "prices masked from staff"],
    ["Awaiting your approval", s.pending_approval_count, "e-tender approval"],
  ];
  return `<div class="ep-kpis">${cells
    .map(([label, value, sub]) => `<div class="ep-kpi">${kicker(label)}<div class="ep-kpi-value">${esc(value)}</div><div class="ep-sub">${esc(sub)}</div></div>`)
    .join("")}</div>`;
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
    <div class="ep-k" style="margin-bottom:9px">Procurement pipeline</div>
    <div class="ep-pipeline">${stages
      .map(
        ([name, note, done], i) => `<div class="ep-stage">
          <div style="display:flex;align-items:center;gap:7px">
            <span class="ep-stage-dot" style="background:${done ? "#1d4ed8" : "rgba(32,30,29,.18)"};color:${done ? "#f3f2f2" : "#201e1d"}">${i + 1}</span>
            <span style="font-size:12.5px;font-weight:800">${esc(name)}</span>
          </div>
          <div class="ep-sub" style="line-height:1.4">${esc(note)}</div>
          <div style="height:3px;margin-top:auto;background:${done ? "#1d4ed8" : "rgba(32,30,29,.18)"}"></div>
        </div>`
      )
      .join("")}</div>
  </div>`;
}

function vendorBase(s) {
  const v = s.vendors_by_status;
  const total = Object.values(v).reduce((a, b) => a + b, 0) || 1;
  const rows = [
    ["Active", v.active || 0, "#2f8f4e"],
    ["Pending verification", v.pending_verification || 0, "#ff9783"],
    ["Info requested", v.info_requested || 0, "#7d7979"],
    ["Suspended", v.suspended || 0, "#201e1d"],
    ["Rejected", v.rejected || 0, "rgba(32,30,29,.45)"],
    ["Blacklisted", v.blacklisted || 0, "#201e1d"],
  ];
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Vendor base</span></div>
    <div style="padding:14px">
      ${rows
        .map(
          ([label, n, color]) => `<div style="margin-bottom:13px">
            <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600"><span>${label}</span><span>${n}</span></div>
            <div class="ep-bar" style="margin-top:5px"><div style="width:${(n / total) * 100}%;background:${color}"></div></div>
          </div>`
        )
        .join("")}
    </div>
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
    const queue = actionQueue(s);
    root.innerHTML = `<div style="display:flex;flex-direction:column;gap:22px">
      ${kpiStrip(s)}
      ${pipeline(s)}
      <div class="ep-grid" style="grid-template-columns:1.45fr 1fr">${queue.html}${vendorBase(s)}</div>
    </div>`;
    wireActionQueue(root, queue);
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}
