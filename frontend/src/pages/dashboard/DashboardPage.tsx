import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuthState } from "../../lib/authStore";
import { applyDashboardStats } from "../../lib/chromeStore";
import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { PipelineTracker, type StageRow } from "./PipelineTracker";
import { ActionQueuePanel } from "./ActionQueuePanel";
import { VendorBasePanel } from "./VendorBasePanel";
import { OfficerDashboard } from "./OfficerDashboard";
import { CategoryManagerDashboard } from "./CategoryManagerDashboard";
import { ApprovingAuthorityDashboard } from "./ApprovingAuthorityDashboard";
import { fmtDate } from "../../lib/format";
import type { CurrentUser, DashboardStats } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/dashboardPage.js -- staff dashboard: the
// prototype's command-centre layout, fed by GET /dashboard/stats (real
// counts only). Role-specific dashboards live in their own component --
// Procurement Officer, Category Manager / Procurement Admin and Approving
// Authority (ported above) -- System Admin still shares this generic view
// below (it has every tab, so no one pipeline fits it).
//
// Dispatch mirrors loadDashboard()'s exactly: role AND the matching stats
// sub-object both have to agree, not just field presence -- the Category
// Manager/Procurement Admin branch in particular dispatches on role alone
// (categoryManager renders its tracker only `{c && ...}`, so a role match
// with a still-null `category_manager` falls through to the generic KPIs
// gracefully, same as vanilla). Role now comes from the shared auth store
// (AuthBoot.tsx already fetched it) rather than its own /auth/me -- found
// 2026-10-15 via the browser's network panel: this page's own fetch and
// AuthBoot's were firing side by side on every load, same endpoint, same
// moment, for no reason -- the role was already sitting in the store.
function kpiCells(s: DashboardStats): KpiCell[] {
  return [
    ["Live tenders", s.open_tenders_count, s.next_bid_close ? `next bid close ${fmtDate(s.next_bid_close)}` : "none open for bidding", null, "file-text", "primary"],
    ["Active vendors", s.vendors_by_status.active || 0, `${s.vendors_by_status.suspended || 0} suspended · ${(s.vendors_by_status.pending_verification || 0) + (s.vendors_by_status.info_requested || 0)} pending`, null, "users", "success"],
    ["Bids submitted", s.bids_submitted_count, "prices masked from staff", null, "check-square", "info"],
    ["Awaiting your approval", s.pending_approval_count, "e-tender approval", null, "clock", "warning"],
  ];
}

// Vuexy-style pipeline card: same donut + icon-row tracker component as the
// Procurement Officer's and Category Manager's own dashboards, not a plain
// list. Each stage is the *current backlog* sitting at that step, the same
// thing their stage counts mean (e.g. the Officer's "pending_approval_count"
// is tenders waiting right now, not a cumulative total): vendors awaiting
// KYC, mapping requests awaiting decision, ratings overdue for manual
// refresh, tenders awaiting E-Tender Approval, and lines whose bidding
// closed but technical evaluation isn't done.
function stages(s: DashboardStats): StageRow[] {
  return [
    { label: "Vendor registration", icon: "users", tone: "primary", note: "awaiting KYC decision", count: s.vendors_pending_count },
    { label: "Master & mapping", icon: "layers", tone: "info", note: "mapping requests awaiting decision", count: s.mappings_pending_count },
    { label: "Rating refresh", icon: "star", tone: "warning", note: "manual update overdue (90+ days)", count: s.stale_ratings.length },
    { label: "Tender & publishing", icon: "clock", tone: "danger", note: "tenders awaiting E-Tender Approval", count: s.pending_approval_count },
    { label: "Bid → L1 → PO", icon: "check-square", tone: "success", note: "line(s) ready for technical evaluation", count: s.eval_workload.length },
  ];
}

function GenericDashboard({ s, role }: { s: DashboardStats; role: CurrentUser["role"] }) {
  return (
    <div className="d-flex flex-col gap-22px">
      <KpiStrip cells={kpiCells(s)} />
      <PipelineTracker subtitle="where the system-wide backlog sits, now" stages={stages(s)} pickColors={(p) => [p.primary, p.info, p.warning, p.danger, p.success]} />
      <div className="ep-grid grid-cols-1-45fr-1fr">
        <ActionQueuePanel s={s} role={role} />
        <VendorBasePanel s={s} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const role = useAuthState().user?.role ?? null;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await api<DashboardStats>("/dashboard/stats");
        setStats(s);
        // Feeds AppShell's sidebar badges/topbar counts from the same
        // fetch instead of letting its own refreshChrome() request the
        // identical /dashboard/stats a second time right alongside this one.
        applyDashboardStats(s);
      } catch (err) {
        setError("Could not load dashboard: " + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, []);

  if (error) return <div className="result err">{error}</div>;
  if (!stats || !role) return null;

  if (role === "procurement_officer" && stats.officer) return <OfficerDashboard s={stats} role={role} />;
  if (role === "category_manager" || role === "procurement_admin") return <CategoryManagerDashboard s={stats} role={role} />;
  if (role === "approving_authority" && stats.approving_authority) return <ApprovingAuthorityDashboard s={stats} role={role} />;
  return <GenericDashboard s={stats} role={role} />;
}
