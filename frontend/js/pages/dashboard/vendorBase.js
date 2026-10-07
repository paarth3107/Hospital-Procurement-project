import { donut } from "../../charts.js";

// ---- Vendor status breakdown -- shared by the generic dashboard and the
// Category Manager / Procurement Admin dashboard (vendor lifecycle is
// genuinely their job, unlike Procurement Officer's dashboard which drops
// this panel entirely, 2026-09-29). Drawn as a donut (2026-10-06). ----
const STATUSES = [
  ["Active", "active", (p) => p.success],
  ["Pending verification", "pending_verification", (p) => p.warning],
  ["Info requested", "info_requested", (p) => p.info],
  ["Suspended", "suspended", (p) => p.danger],
  ["Rejected", "rejected", (p) => p.muted],
  ["Blacklisted", "blacklisted", (p) => p.ink],
];

export function vendorBase(s) {
  const total = STATUSES.reduce((sum, [, key]) => sum + (s.vendors_by_status[key] || 0), 0);
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Vendor base</span><span class="ep-k">${total} vendors</span></div>
    <div class="ep-pane-pad">
      ${total ? '<div id="vendor-base-chart"></div>' : '<div class="hint">No vendors registered yet.</div>'}
    </div>
  </div>`;
}

// Call after vendorBase()'s markup is in the DOM.
export function drawVendorBase(s) {
  const el = document.getElementById("vendor-base-chart");
  if (!el) return;
  const rows = STATUSES.filter(([, key]) => (s.vendors_by_status[key] || 0) > 0);
  donut(el, {
    labels: rows.map(([label]) => label),
    series: rows.map(([, key]) => s.vendors_by_status[key]),
    pickColors: (p) => rows.map(([, , color]) => color(p)),
  });
}
