import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { fmtDateTime, inr } from "../../lib/format";
import { refreshChrome } from "../../lib/bridge";
import { Tag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { ApprovalRound, Tender, TenderReview } from "../../lib/types";
import { ApprovalReviewPanel } from "./ApprovalReviewPanel";

// Ported 1:1 from frontend/js/pages/approvalsPage.js -- E-Tender Approval
// (Module 4B): the gate that publishes a tender to its eligible vendors.
// The inbox lists tenders waiting on a decision at their resolved tier;
// Review opens everything the approver needs (header terms, lines, the
// vendors each would go to, history) and the decision lives there, so
// nothing is approved or rejected without being looked at. Reached at
// /approvals (inbox) or /approvals/:id (review a specific tender) -- real
// bug, fixed 2026-10-22 (same class as Vendor View/Tender Editor): which
// tender to review used to arrive through transient module state
// (lib/bridge.ts's takePendingReviewId()), so a refresh or a direct link
// from the dashboard's own deep link lost it and fell back to the bare
// inbox instead of the specific tender.
interface InboxRow {
  t: Tender;
  round: ApprovalRound | undefined;
  review: TenderReview;
}

export function ApprovalsPage() {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const reviewId = idParam ? Number(idParam) : null;
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const loadInbox = useCallback(async () => {
    try {
      const tenders = await api<Tender[]>("/tenders?status_filter=pending_approval");
      const built = await Promise.all(
        tenders.map(async (t) => {
          const [rounds, review] = await Promise.all([api<ApprovalRound[]>(`/tenders/${t.id}/approval-rounds`), api<TenderReview>(`/tenders/${t.id}/approval-review`)]);
          return { t, round: rounds.find((r) => r.round_number === t.round_number), review };
        })
      );
      setRows(built);
      setError("");
    } catch (err) {
      setError("Could not load approval queue: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  // No inbox fetch needed while reviewing a specific tender -- only load it
  // once there's no id in the URL (the bare /approvals inbox).
  useEffect(() => {
    if (!idParam) loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam]);

  const backToInbox = (message?: string) => {
    navigate("/approvals", { replace: true });
    setFlash(message ?? "");
    loadInbox();
  };

  const onDecided = (message: string) => {
    backToInbox(message);
    refreshChrome();
  };

  if (reviewId != null) {
    return <ApprovalReviewPanel tenderId={reviewId} onBack={() => backToInbox()} onDecided={onDecided} />;
  }

  if (error && !rows.length) return <div className="result err">{error}</div>;

  const { pageItems, totalPages, page: clampedPage } = pageSlice(rows, page);

  return (
    <div className="d-flex flex-col gap-18px">
      <div className="hint maxw-900px lh-1-5">
        The gate that actually publishes a tender and notifies vendors. Open a tender to review all of its details before deciding. Each submission is a numbered round; a
        rejection returns it to Draft with mandatory comments, and repeated rejections escalate to the next approving tier.
      </div>
      <div className="ep-pane">
        <div className="ep-pane-head">
          <span>Approval Inbox</span>
          <span className="ep-k">{rows.length} pending</span>
        </div>
        <table className="ep-table">
          <thead>
            <tr>
              {["Tender", "Round", "Value", "Required tier", "Bids close", ""].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!pageItems.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={6}>
                  Nothing is waiting for approval.
                </td>
              </tr>
            ) : (
              pageItems.map(({ t, round, review }) => (
                <tr key={t.id}>
                  <td className="ep-cell">
                    <div className="fw-600">{t.title}</div>
                    <div className="ep-sub">
                      #{t.id}
                      {t.department ? ` · ${t.department}` : ""} · {review.lines.length} line(s)
                    </div>
                    {review.warnings.length > 0 && <div className="ep-sub text-danger-700">{review.warnings.length} warning(s)</div>}
                  </td>
                  <td className="ep-cell">{t.round_number}</td>
                  <td className="ep-cell fw-600">{inr(review.total_estimated_value)}</td>
                  <td className="ep-cell">
                    <Tag text={round ? "Tier " + round.required_tier : "—"} tone="att" />
                  </td>
                  <td className="ep-cell fs-12-5px">{fmtDateTime(t.bid_due_date)}</td>
                  <td className="ep-cell text-right">
                    <button className="ep-b" data-v="p" onClick={() => navigate(`/approvals/${t.id}`)}>
                      Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={clampedPage} totalPages={totalPages} onChange={setPage} />
      </div>
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
