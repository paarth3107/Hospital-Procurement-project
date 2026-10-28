import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { switchView } from "../../lib/bridge";
import { Tag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { PortalTender } from "../../lib/types";

// Split out of VendorTendersPage.tsx (2026-10-28, user-directed): "Tenders"
// in the sidebar used to be one tab showing both the Tender Invitations
// table and the Your Bids table stacked on one page -- now its own tab,
// VendorBidsPage.tsx the other. Originally split out of
// VendorDashboardPage.tsx (2026-10-23, user-directed): the Dashboard's own
// "Open Invitations" table only ever had a plain show/hide-closed
// checkbox, nothing like a real filter -- this is the dedicated,
// full-browse version with the Open/Submitted/Closed filter the user asked
// for. The Dashboard keeps its KPI strip and a "Latest 5" preview of this
// same table (VendorDashboardPage.tsx's InvitationsPreview), not a second
// copy of the whole thing.
//
// Awarded/No Award dropped as their own categories here (2026-10-28,
// user-directed): "the award or not awarded status belongs to your bids
// because that's where you see which lines you actually won" -- an
// awarded/no-award tender is just a closed (or already-submitted) one from
// this table's point of view; the actual win/loss result only ever shows
// in VendorBidsPage.tsx's own Outcome column.

// Computed, mutually exclusive per-tender state -- a tender can only ever
// be in exactly one of these at a time, checked in this priority order:
// "did this vendor submit anything" wins over "is it still biddable",
// since a submitted bid can outlive its own deadline (amend is allowed
// right up to it, but a line stays Submitted after -- including once the
// tender's own result, awarded or not, is in).
type TenderFilter = "all" | "open" | "submitted" | "closed";
const FILTERS: [TenderFilter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["submitted", "Submitted"],
  ["closed", "Closed"],
];

interface TenderGroup {
  t: PortalTender;
  lines: PortalTender["line_items"];
}

function groupByTender(tenders: PortalTender[]): TenderGroup[] {
  return tenders.map((t) => ({ t, lines: t.line_items }));
}

function category(g: TenderGroup): Exclude<TenderFilter, "all"> {
  if (g.lines.some((li) => li.bid_status === "submitted")) return "submitted";
  return g.t.can_bid ? "open" : "closed";
}

function timeRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function TenderRow({ group }: { group: TenderGroup }) {
  const { t, lines } = group;
  const cat = category(group);
  const submitted = lines.filter((li) => li.bid_status === "submitted").length;
  const statusTag =
    cat === "closed" ? (
      <Tag text="Closed" tone="neg" />
    ) : submitted === lines.length ? (
      <Tag text="All submitted" tone="pos" />
    ) : submitted > 0 ? (
      <Tag text={`${submitted} of ${lines.length} submitted`} tone="att" />
    ) : (
      <Tag text="Not started" tone="att" />
    );
  return (
    <tr>
      <td className="ep-cell">
        <div className="fw-700">{t.title}</div>
        <div className="ep-sub">
          #{t.tender_id} · {t.facility_name}
        </div>
      </td>
      <td className="ep-cell fs-12px">{t.tender_type}</td>
      <td className="ep-cell fs-12-5px">{lines.length}</td>
      <td className="ep-cell fs-12-5px">
        {t.bid_due_date ? (
          <>
            <div className="fw-600">{t.can_bid ? timeRemaining(t.bid_due_date) : "closed"}</div>
            <div className="ep-sub">{fmtDateTime(t.bid_due_date)}</div>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="ep-cell">{statusTag}</td>
      <td className="ep-cell text-right nowrap">
        {(t.can_bid || submitted > 0) && (
          <button className="ep-b" data-v="p" onClick={() => switchView(`bid/${t.tender_id}`)}>
            {submitted > 0 ? "View Bid" : "Prepare Bid"}
          </button>
        )}
      </td>
    </tr>
  );
}

export function VendorInvitationsPage() {
  const [tenders, setTenders] = useState<PortalTender[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [params, setParams] = useSearchParams();
  // Deep-linkable (e.g. the Dashboard's KPI tiles) via ?filter=open rather
  // than transient component state -- a refresh or a direct link keeps
  // whichever filter was selected instead of silently resetting to "All".
  const rawFilter = params.get("filter");
  const filter: TenderFilter = FILTERS.some(([k]) => k === rawFilter) ? (rawFilter as TenderFilter) : "all";
  const setFilter = (f: TenderFilter) => {
    setPage(0);
    setParams(f === "all" ? {} : { filter: f }, { replace: true });
  };

  const load = useCallback(async () => {
    try {
      setTenders(await api<PortalTender[]>("/vendor-portal/tenders"));
      setError("");
    } catch (err) {
      setError("Could not load tenders: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !tenders.length) return <div className="result err">{error}</div>;

  const allGroups = groupByTender(tenders);
  const counts = FILTERS.reduce((acc, [k]) => {
    acc[k] = k === "all" ? allGroups.length : allGroups.filter((g) => category(g) === k).length;
    return acc;
  }, {} as Record<TenderFilter, number>);
  const byDeadline = (a: TenderGroup, b: TenderGroup) =>
    new Date(a.t.bid_due_date || 8640000000000000).getTime() - new Date(b.t.bid_due_date || 8640000000000000).getTime();
  const groups = (filter === "all" ? allGroups : allGroups.filter((g) => category(g) === filter)).slice().sort(byDeadline);

  const { pageItems, totalPages, page: clamped } = pageSlice(groups, page);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Tender Invitations</span>
      </div>
      <div className="ep-pane-pad d-flex items-center gap-14px flex-wrap">
        <div className="ep-seg">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={k === filter ? "on" : ""} onClick={() => setFilter(k)}>
              {label} ({counts[k]})
            </button>
          ))}
        </div>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Tender", "Type", "Line Items", "Time Remaining", "Status", ""].map((h) => (
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
                No tenders in this filter.
              </td>
            </tr>
          ) : (
            pageItems.map((g) => <TenderRow group={g} key={g.t.tender_id} />)
          )}
        </tbody>
      </table>
      <Pagination page={clamped} totalPages={totalPages} onChange={setPage} />
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
