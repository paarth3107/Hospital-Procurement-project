import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { PipelineTracker, type StageRow } from "./PipelineTracker";
import { ActionQueuePanel } from "./ActionQueuePanel";
import { TenderProgressCard } from "./TenderProgressCard";
import { switchView } from "../../lib/bridge";
import { fmtDate } from "../../lib/format";
import type { DashboardOfficer, DashboardOfficerTender, DashboardStats } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/dashboard/officerDashboard.js --
// Procurement Officer's own dashboard (product decision, 2026-09-29 -- the
// spec has no dashboard requirements). A tender-lifecycle pipeline built
// only from stages this role drives or is directly waiting on:
//   Draft -> Pending E-Tender Approval -> Published (bidding open)
//   -> Ready to recommend -> Awaiting L1 approval
// Deliberately excludes Category Manager's stages (vendor registration,
// mapping, rating refresh) and "technical evaluation in progress" -- the
// Officer has nothing to do while that's running; a line simply appears in
// "Ready to recommend" once it closes. "Awaiting L1 approval" stays as a
// tracking-only stage (not phrased as an action): there is nothing further
// for the Officer to do once a recommendation is approved -- the tender
// finalizes on its own. It's kept visible only so the Officer knows what's
// still out for a decision, and it folds back into "Ready to recommend" if
// the Approving Authority sends it back instead.

// Each card jumps to where that work actually happens: Draft -> Tenders (to
// keep editing/submit it), Pending approval / Live -> Bid evaluation (where
// their progress is tracked), Ready to recommend -> L1 award.
function kpiCells(o: DashboardOfficer): KpiCell[] {
  return [
    ["Draft tenders", o.draft_count, "", "tenders?status=draft", "file-text", "primary"],
    ["Pending approval", o.pending_approval_count, "", "evaluation", "clock", "warning"],
    ["Live tenders", o.live_count, "", "evaluation", "activity", "success"],
    ["Ready to recommend", o.ready_to_recommend_lines, "", "awards", "award", "info"],
  ];
}

// Stage rows of the tracker: every stage counts tenders; the lines behind
// them are in the note and the table.
function stages(o: DashboardOfficer): StageRow[] {
  return [
    { label: "Draft", icon: "file-text", tone: "primary", note: "not yet submitted for approval", count: o.draft_count },
    { label: "Pending E-Tender Approval", icon: "clock", tone: "warning", note: "sent, waiting on the Approving Authority", count: o.pending_approval_count },
    {
      label: "Published — bidding open",
      icon: "activity",
      tone: "success",
      note: o.awaiting_evaluation_close_count ? `${o.awaiting_evaluation_close_count} more closed, awaiting evaluation (Category Manager)` : "accepting bids",
      count: o.live_count,
    },
    { label: "Ready to recommend", icon: "award", tone: "info", note: `${o.ready_to_recommend_lines} line(s) ready to recommend`, count: o.ready_to_recommend_count },
    { label: "Awaiting L1 approval", icon: "check-square", tone: "primary", note: `${o.awaiting_decision_lines} line(s) sent for approval`, count: o.awaiting_decision_count },
  ];
}

// What's happening on a tender, in one line: bidding status while it's live,
// otherwise why it isn't -- draft, pending approval, or what's left to decide.
function tenderSubtitle(t: DashboardOfficerTender): string {
  const parts = [`${t.lines_total} line item(s)`];
  if (t.status === "draft") parts.push("not yet submitted");
  else if (t.status === "pending_approval") parts.push("waiting on the Approving Authority");
  else if (t.status === "scheduled") parts.push(`approved, publishes ${fmtDate(t.publish_date)}`);
  else if (t.status === "published") {
    const due = t.bid_due_date ? new Date(t.bid_due_date) : null;
    const closed = due !== null && due <= new Date();
    parts.push(`${t.bids_received} bid(s)${due ? `, ${closed ? "closed" : "closes"} ${fmtDate(t.bid_due_date)}` : ""}`);
    if (t.lines_ready_to_recommend) parts.push(`${t.lines_ready_to_recommend} to recommend`);
    if (t.lines_awaiting_decision) parts.push(`${t.lines_awaiting_decision} awaiting approval`);
  }
  return parts.join(" · ");
}

export function OfficerDashboard({ s, role }: { s: DashboardStats; role: "procurement_officer" }) {
  const o = s.officer!;
  return (
    <div className="d-flex flex-col gap-22px">
      <KpiStrip cells={kpiCells(o)} />
      <PipelineTracker subtitle="where your work sits, now" stages={stages(o)} pickColors={(p) => [p.primary, p.warning, p.success, p.info, p.muted]} />
      <div className="ep-grid grid-cols-1-45fr-1fr">
        <ActionQueuePanel s={s} role={role} />
        <div className="ep-pane">
          <TenderProgressCard
            tenders={o.tenders}
            subtitle={tenderSubtitle}
            onOpen={(id) => switchView(`tender-edit/${id}`)}
          />
        </div>
      </div>
    </div>
  );
}
