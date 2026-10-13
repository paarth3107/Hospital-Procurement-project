import { Icon } from "../../lib/icons";
import { Donut } from "../../components/Donut";
import type { DashboardStats } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/dashboard/vendorBase.js -- vendor status
// breakdown, shared by the generic dashboard and the Category Manager /
// Procurement Admin dashboard (vendor lifecycle is genuinely their job,
// unlike the Officer's dashboard, which drops this panel entirely).
const STATUSES: [label: string, key: string, icon: string, tone: string][] = [
  ["Active", "active", "user-check", "success"],
  ["Pending verification", "pending_verification", "clock", "warning"],
  ["Info requested", "info_requested", "file-text", "info"],
  ["Suspended", "suspended", "shield", "danger"],
  ["Rejected", "rejected", "user", "muted"],
  ["Blacklisted", "blacklisted", "shield", "muted"],
];

const TONE_COLOR: Record<string, "success" | "warning" | "info" | "danger" | "muted"> = {
  success: "success",
  warning: "warning",
  info: "info",
  danger: "danger",
  muted: "muted",
};

export function VendorBasePanel({ s }: { s: DashboardStats }) {
  const total = STATUSES.reduce((sum, [, key]) => sum + (s.vendors_by_status[key] || 0), 0);
  // Every status shown, zero-count ones included -- a complete at-a-glance
  // breakdown, not just whichever ones happen to be non-empty right now.
  const nonZero = STATUSES.filter(([, key]) => (s.vendors_by_status[key] || 0) > 0);
  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Vendor Base</span>
        <span className="ep-k">{total} vendor(s)</span>
      </div>
      <div className="ep-pane-pad">
        {total ? (
          <div className="d-flex flex-wrap gap-24px items-center">
            <div className="flex-1 minw-0">
              <Donut
                labels={nonZero.map(([label]) => label)}
                series={nonZero.map(([, key]) => s.vendors_by_status[key])}
                pickColors={(p) => nonZero.map(([, , , tone]) => p[TONE_COLOR[tone]])}
              />
            </div>
            <div className="d-flex flex-col gap-16px flex-1 minw-0">
              {STATUSES.map(([label, key, ic, tone]) => (
                <div className="d-flex items-center gap-12px" key={key}>
                  <span className={`ep-kpi-icon tone-${tone}`}>
                    <Icon name={ic} size={20} />
                  </span>
                  <div className="flex-1 minw-0 fw-600">{label}</div>
                  <span className="fw-800 fs-16px">{s.vendors_by_status[key] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="hint">No vendors registered yet.</div>
        )}
      </div>
    </div>
  );
}
