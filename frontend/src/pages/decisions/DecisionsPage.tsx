import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { useAuthState } from "../../lib/authStore";
import { refreshChrome } from "../../lib/bridge";
import { useModal } from "../../components/useModal";
import { Tag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import { OVERRIDE_TYPE_LABELS } from "../../lib/constants";
import type { OverrideOut } from "../../lib/types";

// Spec §12 -- the generic "pending overrides needing MY decision" inbox
// (2026-10-22, user-directed): every override type lands here once it's
// escalated or routed to a real decider, regardless of which page the
// request itself came from (TenderDetail's due-date-extension row, an
// Evaluation line's late-submission row, ...). The dashboard's Action Queue
// (ActionQueuePanel.tsx) surfaces the same items as rows that just switch
// here -- this page is the one place that actually decides them.
//
// Dispatches approve/reject to the real per-type mutation endpoint, never
// the generic /overrides/{id}/approve -- that one only flips the override's
// own status (services/overrides.py's approve_override docstring: applying
// the change to the target record is per-type logic added when a type is
// wired in). A type with no dedicated endpoint here has never been wired to
// a real mutation (non_l1_award_override, po_reexport -- see
// backend/README.md) and should never actually produce a pending row; the
// generic fallback exists only so this page doesn't 404 if one somehow does.
// guest_vendor_invite (Expedited Registration Review) deliberately has no
// entry either, same reason -- reverted to an ungoverned direct action
// 2026-10-22, so nothing creates a pending one anymore; any row of that
// type still in the DB is historical (from before the revert) and already
// Approved/Rejected, not something to decide.
const DECIDE_BASE: Record<string, string> = {
  price_competitiveness_override: "/ratings/price-competitiveness-overrides",
  invite_list_manual_add: "/tenders/manual-invite-requests",
  technical_score_correction: "/evaluation/evaluation-corrections",
  late_submission_exception: "/tenders/late-submission-exceptions",
  due_date_extension: "/tenders/bid-due-date-extensions",
};

function canDecide(me: { role: string; approval_tier: number | null }, o: OverrideOut): boolean {
  if (me.role === "system_admin") return true;
  if (o.required_approver_role !== me.role) return false;
  return o.required_approver_min_tier == null || (me.approval_tier ?? 0) >= o.required_approver_min_tier;
}

export function DecisionsPage() {
  const me = useAuthState().user;
  const [rows, setRows] = useState<OverrideOut[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const { confirmAsync, reasonAsync, modalElement } = useModal();

  const load = useCallback(async () => {
    try {
      const all = await api<OverrideOut[]>("/overrides");
      setRows(all.filter((o) => (o.status === "pending_approval" || o.status === "escalated") && me != null && canDecide(me, o)));
      setError("");
    } catch (err) {
      setError("Could not load pending decisions: " + (err instanceof Error ? err.message : String(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role, me?.approval_tier]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (o: OverrideOut, approve: boolean) => {
    const base = DECIDE_BASE[o.override_type] ?? "/overrides";
    const label = OVERRIDE_TYPE_LABELS[o.override_type] ?? o.override_type;
    try {
      if (approve) {
        if (!(await confirmAsync(`Approve this ${label}? "${o.justification}"`, { confirmLabel: "Approve" }))) return;
        await api(`${base}/${o.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      } else {
        const reason = await reasonAsync({
          title: `Decline ${label}`,
          placeholder: "e.g. Justification does not meet policy for this value band",
          confirmLabel: "Decline request",
          danger: true,
        });
        if (!reason) return;
        await api(`${base}/${o.id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      }
      await load();
      refreshChrome();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error && !rows.length) return <div className="result err">{error}</div>;

  const { pageItems, totalPages, page: clamped } = pageSlice(rows, page);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Decisions</span>
        <span className="ep-k">{rows.length} pending</span>
      </div>
      <div className="hint padding-10px-16px">
        Every override currently resolved to your role and tier -- late-submission exceptions, bid due-date extensions escalated past their
        threshold, expedited registration reviews, and any other governed override waiting on you specifically.
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Type", "What's being asked", "Requested", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!pageItems.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={4}>
                Nothing is waiting on your decision right now.
              </td>
            </tr>
          ) : (
            pageItems.map((o) => (
              <tr key={o.id}>
                <td className="ep-cell">
                  <div className="fw-600">{OVERRIDE_TYPE_LABELS[o.override_type] ?? o.override_type}</div>
                  {o.status === "escalated" && <Tag text="Escalated" tone="esc" />}
                </td>
                <td className="ep-cell">
                  <div className="fw-600">{o.entity_label ?? `#${o.entity_id ?? "—"}`}</div>
                  <div className="ep-sub">
                    {o.reason_code} -- {o.justification}
                  </div>
                </td>
                <td className="ep-cell fs-12-5px">
                  {fmtDateTime(o.created_at)}
                  <div className="ep-sub">by {o.initiator_role.replace(/_/g, " ")}</div>
                </td>
                <td className="ep-cell text-right nowrap">
                  <button className="ep-b" data-v="p" onClick={() => decide(o, true)}>
                    Approve
                  </button>{" "}
                  <button className="ep-b" onClick={() => decide(o, false)}>
                    Decline
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Pagination page={clamped} totalPages={totalPages} onChange={setPage} />
      {error && <div className="result err">{error}</div>}
      {modalElement}
    </div>
  );
}
