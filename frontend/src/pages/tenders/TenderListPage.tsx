import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { switchView } from "../../lib/bridge";
import { Tag, StateTag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { Tender } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/tendersPage.js -- the list only.
// "+ New tender" opens /tender-edit (blank); Manage opens /tender-edit/:id
// (2026-10-22 -- used to hand the id off through transient bridge state
// instead, which broke on refresh/direct link; see TenderEditorPage.tsx).
const TYPE_LABEL: Record<string, string> = { rfq: "RFQ", rfp: "RFP" };

// Awarded / No award are done -- nothing left to act on. Kept out of the
// list by default (they pile up forever otherwise); a checkbox reveals them
// again without a refetch.
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);

export function TenderListPage() {
  const [allTenders, setAllTenders] = useState<Tender[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setAllTenders(await api<Tender[]>("/tenders"));
      setError("");
    } catch (err) {
      setError("Could not load tenders: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !allTenders.length) return <div className="result err">{error}</div>;

  const closedCount = allTenders.filter((t) => CLOSED_TENDER_STATUSES.has(t.status)).length;
  const filtered = showClosed ? allTenders : allTenders.filter((t) => !CLOSED_TENDER_STATUSES.has(t.status));
  const { pageItems, totalPages, page: clampedPage } = pageSlice(filtered, page);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Tenders</span>
        <div className="d-flex items-center gap-14px">
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
          <button
            className="ep-b"
            data-v="p"
            onClick={() => switchView("tender-edit")}
          >
            + New tender
          </button>
        </div>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["ID", "Title", "Type", "Status", "Bids close", "Round", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!pageItems.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={7}>
                {showClosed ? "No tenders yet." : "No open tenders. Closed/awarded tenders are hidden -- tick the box above to see them."}
              </td>
            </tr>
          ) : (
            pageItems.map((t) => (
              <tr key={t.id}>
                <td className="ep-cell ep-mono fs-12px">#{t.id}</td>
                <td className="ep-cell">
                  <div className="fw-600">{t.title}</div>
                  <div className="ep-sub">{t.department || ""}</div>
                </td>
                <td className="ep-cell">
                  <Tag text={TYPE_LABEL[t.tender_type] || t.tender_type} tone="esc" /> {t.is_rate_contract && <Tag text="Rate contract" tone="att" />}
                </td>
                <td className="ep-cell">
                  <StateTag state={t.status} />
                </td>
                <td className="ep-cell fs-12-5px">{fmtDateTime(t.bid_due_date)}</td>
                <td className="ep-cell">{t.round_number}</td>
                <td className="ep-cell text-right">
                  <button
                    className="ep-b"
                    onClick={() => switchView(`tender-edit/${t.id}`)}
                  >
                    Manage
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
