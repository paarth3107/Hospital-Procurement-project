import { esc, kicker } from "../../kit.js";
import { switchView } from "../../nav.js";
import { actionQueue, wireActionQueue } from "./actionQueue.js";
import { kpiStrip as kpiTiles } from "./kpi.js";
import { drawVendorBase } from "./vendorBase.js";
import { vendorBase } from "./vendorBase.js";

// ---- Category Manager / Procurement Admin's own dashboard (one job, per
// CLAUDE.md) -- product decision, 2026-09-30. Replaces the generic
// dashboard's PO-facing numbers (Live tenders / Awaiting your approval /
// Bids submitted aren't this role's job -- it doesn't even have an
// "approvals" tab) with the four queues this role actually runs.
//
// No pipeline visualization here, unlike the Officer's dashboard: a tender
// genuinely flows through one lifecycle in order, but this role's work is
// several independent queues running in parallel (KYC, mapping, rating
// hygiene, technical evaluation) -- forcing that into a single funnel would
// be decoration, not information. Just the real numbers and the queue. ----

function kpiStrip(s) {
  return kpiTiles([
    ["Vendor KYC", s.vendors_pending_count, s.docs_to_verify.length ? `+${s.docs_to_verify.length} vendor(s) with documents to verify` : "new registrations awaiting review", "queue", "user-check", "primary"],
    ["Mapping requests", s.mappings_pending_count, "vendor category / item eligibility", "mappings", "layers", "info"],
    ["Ready for technical evaluation", s.eval_workload.length, "bidding closed, not yet scored", "evaluation", "bar-chart", "success"],
    ["Ratings needing refresh", s.stale_ratings.length, "no manual update in 90+ days", "ratings", "star", "warning"],
  ]);
}

export function renderCategoryManagerDashboard(root, s) {
  const queue = actionQueue(s);
  root.innerHTML = `<div class="d-flex flex-col gap-22px">
    ${kpiStrip(s)}
    <div class="ep-grid grid-cols-1-45fr-1fr">${queue.html}${vendorBase(s)}</div>
  </div>`;
  wireActionQueue(root, queue);
  root.querySelectorAll(".ep-kpi[data-view]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  drawVendorBase(s);
}
