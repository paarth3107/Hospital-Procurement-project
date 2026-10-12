import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { PipelineTracker, type StageRow } from "./PipelineTracker";
import { ActionQueuePanel } from "./ActionQueuePanel";
import { TenderProgressCard } from "./TenderProgressCard";
import { setPendingReviewId, setPendingAwardId, switchView } from "../../lib/bridge";
import { fmtDate } from "../../lib/format";
import type { DashboardApprovingAuthority, DashboardApprovingAuthorityTender, DashboardStats } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/dashboard/approvingAuthorityDashboard.js
// -- Approving Authority's own dashboard (product decision, 2026-10-07 --
// mirrors the Procurement Officer's). A pipeline built only from the two
// gates this role decides:
//   Pending E-Tender Approval -> (Published, tracking) -> Awaiting your L1 decision
// "Ready for L1 recommendation" is kept as a tracking-only stage (the
// Officer's job, nothing for this role to do yet) the same way the Officer's
// own dashboard tracks "Awaiting L1 approval" without being able to act on
// it. Draft tenders are the Officer's job entirely and don't appear here.

// Each card jumps to where that work actually happens: Pending approval ->
// E-Tender Approval inbox, Awaiting your decision -> L1 Award.
function kpiCells(a: DashboardApprovingAuthority): KpiCell[] {
  return [
    ["Pending E-Tender Approval", a.pending_approval_count, "needs your decision", "approvals", "clock", "warning"],
    ["Live tenders", a.live_count, "bidding open", null, "activity", "success"],
    ["Ready to recommend", a.ready_to_recommend_lines, `${a.ready_to_recommend_count} tender(s) · the Officer's job`, null, "award", "info"],
    ["Awaiting your decision", a.awaiting_decision_lines, `${a.awaiting_decision_count} tender(s)`, "awards", "check-square", "primary"],
  ];
}

// Stage rows of the tracker: every stage counts tenders; the lines behind
// them are in the note and the table.
function stages(a: DashboardApprovingAuthority): StageRow[] {
  return [
    { label: "Pending E-Tender Approval", icon: "clock", tone: "warning", note: "needs your decision", count: a.pending_approval_count },
    { label: "Published — bidding open", icon: "activity", tone: "success", note: "bidding open", count: a.live_count },
    { label: "Ready for L1 recommendation", icon: "file-text", tone: "info", note: `${a.ready_to_recommend_lines} line(s) — the Officer's job`, count: a.ready_to_recommend_count },
    { label: "Awaiting your L1 decision", icon: "check-square", tone: "primary", note: `${a.awaiting_decision_lines} line(s) waiting on you`, count: a.awaiting_decision_count },
  ];
}

// What's happening on a tender, in one line: why it's still Pending Approval,
// or bidding status plus what's left to decide while it's Published.
function tenderSubtitle(t: DashboardApprovingAuthorityTender): string {
  const parts = [`${t.lines_total} line item(s)`];
  if (t.status === "pending_approval") parts.push(t.needs_your_approval ? "needs your decision" : `waiting on tier ${t.required_tier}`);
  else if (t.status === "published") {
    const due = t.bid_due_date ? new Date(t.bid_due_date) : null;
    const closed = due !== null && due <= new Date();
    parts.push(`${t.bids_received} bid(s)${due ? `, ${closed ? "closed" : "closes"} ${fmtDate(t.bid_due_date)}` : ""}`);
    if (t.lines_ready_to_recommend) parts.push(`${t.lines_ready_to_recommend} ready for recommendation`);
    if (t.lines_awaiting_decision) parts.push(`${t.lines_awaiting_decision} awaiting your decision`);
  }
  return parts.join(" · ");
}

export function ApprovingAuthorityDashboard({ s, role }: { s: DashboardStats; role: "approving_authority" }) {
  const a = s.approving_authority!;
  // Pending Approval opens the review, Published opens the award stage.
  const byId = new Map(a.tenders.map((t) => [t.id, t]));
  return (
    <div className="d-flex flex-col gap-22px">
      <KpiStrip cells={kpiCells(a)} />
      <PipelineTracker subtitle="where your decisions sit, now" stages={stages(a)} pickColors={(p) => [p.warning, p.success, p.info, p.primary]} />
      <div className="ep-grid grid-cols-1-45fr-1fr">
        <ActionQueuePanel s={s} role={role} />
        <div className="ep-pane">
          <TenderProgressCard
            tenders={a.tenders}
            subtitle={tenderSubtitle}
            onOpen={(id) => {
              if (byId.get(id)?.status === "pending_approval") {
                setPendingReviewId(id);
                switchView("approvals");
              } else {
                setPendingAwardId(id);
                switchView("awards");
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
