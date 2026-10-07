import { donut } from "../../charts.js";
import { icon } from "../../icons.js";
import { esc } from "../../kit.js";

// ---- Vendor status breakdown -- shared by the generic dashboard and the
// Category Manager / Procurement Admin dashboard (vendor lifecycle is
// genuinely their job, unlike Procurement Officer's dashboard which drops
// this panel entirely, 2026-09-29). Same Vuexy tracker layout as the
// Officer's "Procurement pipeline" card (2026-10-07): a donut beside a row
// per status, instead of a donut with just a legend. ----
const STATUSES = [
  ["Active", "active", "user-check", "success"],
  ["Pending verification", "pending_verification", "clock", "warning"],
  ["Info requested", "info_requested", "file-text", "info"],
  ["Suspended", "suspended", "shield", "danger"],
  ["Rejected", "rejected", "user", "muted"],
  ["Blacklisted", "blacklisted", "shield", "muted"],
];

export function vendorBase(s) {
  const total = STATUSES.reduce((sum, [, key]) => sum + (s.vendors_by_status[key] || 0), 0);
  // Every status shown, zero-count ones included -- a complete at-a-glance
  // breakdown, not just whichever ones happen to be non-empty right now.
  const rows = STATUSES.map(
    ([label, key, ic, tone]) => `<div class="d-flex items-center gap-12px">
        <span class="ep-kpi-icon tone-${tone}">${icon(ic, 20)}</span>
        <div class="flex-1 minw-0 fw-600">${esc(label)}</div>
        <span class="fw-800 fs-16px">${s.vendors_by_status[key] || 0}</span>
      </div>`
  ).join("");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Vendor base</span><span class="ep-k">${total} vendor(s)</span></div>
    <div class="ep-pane-pad">
      ${
        total
          ? `<div class="d-flex flex-wrap gap-24px items-center"><div id="vendor-base-chart" class="flex-1 minw-0"></div><div class="d-flex flex-col gap-16px flex-1 minw-0">${rows}</div></div>`
          : '<div class="hint">No vendors registered yet.</div>'
      }
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
    pickColors: (p) => rows.map(([, , , tone]) => ({ success: p.success, warning: p.warning, info: p.info, danger: p.danger, muted: p.muted }[tone])),
  });
}
