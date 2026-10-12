import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { TenderEvalSummary } from "../../lib/types";
import { TenderEvaluationPanel } from "./TenderEvaluationPanel";

// Ported 1:1 from frontend/js/pages/evaluation/evaluationPage.js -- bid
// evaluation (Officer, Category Manager, Procurement Admin), grouped by
// tender: mirrors Awards/E-Tender-Approval's own tender-grouped layout
// instead of a flat cross-tender line list. Open a tender to see every one
// of its published lines together, track submissions and, after the due
// date, evaluate the technical envelope.
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);

export function EvaluationPage() {
  const [allTenders, setAllTenders] = useState<TenderEvalSummary[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setAllTenders(await api<TenderEvalSummary[]>("/evaluation/tenders"));
      setError("");
    } catch (err) {
      setError("Could not load bid evaluation: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (selected != null) {
    return <TenderEvaluationPanel tenderId={selected} onBack={() => setSelected(null)} />;
  }

  if (error && !allTenders.length) return <div className="result err">{error}</div>;

  const closedCount = allTenders.filter((t) => CLOSED_TENDER_STATUSES.has(t.tender_status)).length;
  const filtered = showClosed ? allTenders : allTenders.filter((t) => !CLOSED_TENDER_STATUSES.has(t.tender_status));
  const { pageItems, totalPages, page: clampedPage } = pageSlice(filtered, page);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Tenders To Evaluate</span>
        <label className="d-flex items-center gap-6px fs-12px fw-400 tt-none ls-0 text-ink-70">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => {
              setShowClosed(e.target.checked);
              setPage(0);
            }}
          />{" "}
          Show closed/awarded ({closedCount})
        </label>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Tender", "Facility", "Bids close", "Lines", "Bids", ""].map((h) => (
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
                {showClosed ? "No published tenders yet." : "Nothing in progress. Closed tenders are hidden -- tick the box above to see them."}
              </td>
            </tr>
          ) : (
            pageItems.map((t) => (
              <tr key={t.tender_id}>
                <td className="ep-cell">
                  <div className="fw-600">{t.tender_title}</div>
                  <div className="ep-sub">#{t.tender_id}</div>
                </td>
                <td className="ep-cell fs-12-5px">{t.facility_name}</td>
                <td className="ep-cell fs-12-5px">{fmtDateTime(t.bid_due_date)}</td>
                <td className="ep-cell fs-12-5px">
                  {t.line_count} line(s)
                  <div className="ep-sub">{t.open_count ? `${t.open_count} still open` : "all closed"}</div>
                </td>
                <td className="ep-cell fs-12-5px">
                  {t.submitted_count} submitted
                  <div className="ep-sub">{t.evaluated_count} evaluated</div>
                </td>
                <td className="ep-cell text-right">
                  <button className="ep-b" onClick={() => setSelected(t.tender_id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Pagination page={clampedPage} totalPages={totalPages} onChange={setPage} />
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
