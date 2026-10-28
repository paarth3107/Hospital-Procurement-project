import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { switchView } from "../../lib/bridge";
import { Tag, StateTag } from "../../components/Tag";
import { IconActionButton } from "../../components/IconActionButton";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { Tender, TenderStatus } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/tendersPage.js -- the list only.
// "+ New tender" opens /tender-edit (blank); Manage opens /tender-edit/:id
// (2026-10-22 -- used to hand the id off through transient bridge state
// instead, which broke on refresh/direct link; see TenderEditorPage.tsx).
const TYPE_LABEL: Record<string, string> = { rfq: "RFQ", rfp: "RFP" };

// Awarded / No award are done -- nothing left to act on. Kept out of the
// list by default (they pile up forever otherwise).
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);

// Replaced the old binary "Show closed/awarded" checkbox with a real
// status dropdown (2026-10-28, user-directed) -- "all" and "open" (the
// old unchecked default: everything except Awarded/No Award) sit above
// the individual statuses, which filter down to exactly one. "All" is
// listed first, but the dropdown still *defaults* to "open" -- list order
// and default selection are independent (see the useState below).
type StatusFilter = "open" | "all" | TenderStatus;
const STATUS_FILTERS: [StatusFilter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["draft", "Draft"],
  ["pending_approval", "Pending Approval"],
  ["scheduled", "Scheduled"],
  ["published", "Published"],
  ["withdrawn", "Withdrawn"],
  ["no_award", "No Award"],
  ["awarded", "Awarded"],
];

export function TenderListPage() {
  const [allTenders, setAllTenders] = useState<Tender[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  // Deep-linkable (e.g. the Officer dashboard's "Draft tenders" KPI tile)
  // via ?status=draft rather than transient component state -- a refresh
  // or a direct link keeps whichever filter was selected instead of
  // silently resetting to the default (2026-10-28, user-directed), same
  // pattern as VendorTendersPage.tsx's own ?filter=.
  const rawStatus = params.get("status");
  const statusFilter: StatusFilter = STATUS_FILTERS.some(([v]) => v === rawStatus) ? (rawStatus as StatusFilter) : "open";
  const setStatusFilter = (f: StatusFilter) => {
    setPage(0);
    setParams(f === "open" ? {} : { status: f }, { replace: true });
  };

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

  const filtered =
    statusFilter === "all"
      ? allTenders
      : statusFilter === "open"
        ? allTenders.filter((t) => !CLOSED_TENDER_STATUSES.has(t.status))
        : allTenders.filter((t) => t.status === statusFilter);
  const { pageItems, totalPages, page: clampedPage } = pageSlice(filtered, page);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>
          Tenders <span className="ep-k">({filtered.length})</span>
        </span>
        <div className="d-flex items-center gap-14px">
          <select
            className="input input-narrow"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            {STATUS_FILTERS.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
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
            {["ID", "Title", "Type", "Status", "Bids close", "Round", "Action"].map((h) => (
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
                {statusFilter === "all"
                  ? "No tenders yet."
                  : statusFilter === "open"
                    ? "No open tenders. Closed/awarded tenders are hidden -- pick a different filter above to see them."
                    : `No tenders with status "${STATUS_FILTERS.find(([v]) => v === statusFilter)?.[1]}".`}
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
                <td className="ep-cell ep-actions-cell text-right">
                  <IconActionButton icon="settings" label="Manage" onClick={() => switchView(`tender-edit/${t.id}`)} />
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
