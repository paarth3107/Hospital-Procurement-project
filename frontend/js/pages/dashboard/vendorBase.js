// ---- Vendor status breakdown -- shared by the generic dashboard and the
// Category Manager / Procurement Admin dashboard (vendor lifecycle is
// genuinely their job, unlike Procurement Officer's dashboard which drops
// this panel entirely, 2026-09-29). ----
export function vendorBase(s) {
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
    <div class="ep-pane-head"><span>Vendor Base</span></div>
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
