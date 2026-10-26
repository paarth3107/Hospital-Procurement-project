import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { PipelineTracker, type StageRow } from "./PipelineTracker";
import { ActionQueuePanel } from "./ActionQueuePanel";
import { VendorBasePanel } from "./VendorBasePanel";
import type { DashboardCategoryManager, DashboardStats, StaffRole } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/dashboard/categoryManagerDashboard.js --
// Category Manager's own dashboard (one job, per
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
// dashboards have, scoped to just that step.
function kpiCells(s: DashboardStats): KpiCell[] {
  return [
    ["Vendor KYC", s.vendors_pending_count, "", "queue", "user-check", "primary"],
    ["Mapping requests", s.mappings_pending_count, "", "mappings-requests", "layers", "info"],
    ["Technical Evaluation", s.eval_workload.length, "", "evaluation", "bar-chart", "success"],
    ["Ratings needing refresh", s.stale_ratings.length, "", "ratings", "star", "warning"],
  ];
}

// Stage rows of the tracker: stage 1 counts tenders (bidding is
// tender-wide); the other two count lines (a tender's lines close
// technical evaluation independently of each other).
function stages(c: DashboardCategoryManager): StageRow[] {
  return [
    { label: "Published — bidding open", icon: "activity", tone: "success", note: `${c.live_count} tender(s) accepting bids`, count: c.live_count },
    { label: "Bidding closed — awaiting evaluation", icon: "bar-chart", tone: "warning", note: `${c.awaiting_evaluation_count} line(s) ready for you to score`, count: c.awaiting_evaluation_count },
    { label: "Technical evaluation closed", icon: "check-square", tone: "info", note: `${c.evaluated_count} line(s) now with the Officer for recommendation`, count: c.evaluated_count },
  ];
}

export function CategoryManagerDashboard({ s, role }: { s: DashboardStats; role: StaffRole }) {
  const c = s.category_manager;
  return (
    <div className="d-flex flex-col gap-22px">
      <KpiStrip cells={kpiCells(s)} />
      {c && <PipelineTracker subtitle="technical evaluation, where it sits now" stages={stages(c)} pickColors={(p) => [p.success, p.warning, p.info]} />}
      <div className="ep-grid grid-cols-1-45fr-1fr">
        <ActionQueuePanel s={s} role={role} />
        <VendorBasePanel s={s} />
      </div>
    </div>
  );
}
