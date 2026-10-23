import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { fmtDateTime, inr } from "../../lib/format";
import { switchView } from "../../lib/bridge";
import { Tag, StateTag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { MyBid, PortalTender } from "../../lib/types";

// Split out of VendorDashboardPage.tsx (2026-10-23, user-directed): the
// Dashboard's own "Open Invitations" table only ever had a plain show/hide-
// closed checkbox, nothing like a real filter -- this is the dedicated,
// full-browse version with the Awarded/Open/Submitted/No Award/Closed
// filter the user asked for, reached from its own sidebar tab instead of
// buried on the Dashboard. The Dashboard keeps its KPI strip (now linking
// here) and status notes, not a second copy of this same table.

// Computed, mutually exclusive per-tender state -- a tender can only ever
// be in exactly one of these at a time, checked in this priority order:
// Awarded/No Award are terminal regardless of what was or wasn't bid;
// otherwise "did this vendor submit anything" wins over "is it still
// biddable", since a submitted bid can outlive its own deadline (amend is
// allowed right up to it, but a line stays Submitted after).
type TenderFilter = "all" | "open" | "submitted" | "awarded" | "no_award" | "closed";
const FILTERS: [TenderFilter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["submitted", "Submitted"],
  ["awarded", "Awarded"],
  ["no_award", "No Award"],
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
  if (g.t.status === "awarded") return "awarded";
  if (g.t.status === "no_award") return "no_award";
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

// Real bug, found 2026-10-14 (VendorDashboardPage.tsx): the Status column
// always showed the bid DOCUMENT's own lifecycle status (draft/submitted/
// withdrawn -- it was submitted and never withdrawn, which stays true
// forever), while a separate Outcome column showed the award result once
// known -- so an awarded bid displayed "Submitted" right next to "Awarded".
// Once outcome is known, show it as the Status tag too.
function bidDisplayStatus(b: MyBid): string {
  if (b.outcome?.startsWith("Awarded")) return "awarded";
  if (b.outcome === "Not selected") return "no_award";
  if (b.outcome === "Technically disqualified") return "disqualified";
  return b.status;
}

function TenderRow({ group }: { group: TenderGroup }) {
  const { t, lines } = group;
  const cat = category(group);
  const submitted = lines.filter((li) => li.bid_status === "submitted").length;
  const statusTag =
    cat === "awarded" ? (
      <Tag text="Tender awarded" tone="neg" />
    ) : cat === "no_award" ? (
      <Tag text="Closed, no award" tone="neg" />
    ) : cat === "closed" ? (
      <Tag text="Deadline passed" tone="neg" />
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

export function VendorTendersPage() {
  const [tenders, setTenders] = useState<PortalTender[]>([]);
  const [bids, setBids] = useState<MyBid[]>([]);
  const [error, setError] = useState("");
  const [tendersPage, setTendersPage] = useState(0);
  const [bidsPage, setBidsPage] = useState(0);
  const [params, setParams] = useSearchParams();
  // Deep-linkable (e.g. the Dashboard's KPI tiles) via ?filter=open rather
  // than transient component state -- a refresh or a direct link keeps
  // whichever filter was selected instead of silently resetting to "All".
  const rawFilter = params.get("filter");
  const filter: TenderFilter = FILTERS.some(([k]) => k === rawFilter) ? (rawFilter as TenderFilter) : "all";
  const setFilter = (f: TenderFilter) => {
    setTendersPage(0);
    setParams(f === "all" ? {} : { filter: f }, { replace: true });
  };

  const load = useCallback(async () => {
    try {
      const [t, b] = await Promise.all([api<PortalTender[]>("/vendor-portal/tenders"), api<MyBid[]>("/vendor-portal/bids")]);
      setTenders(t);
      setBids(b);
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

  const { pageItems: tenderPageItems, totalPages: tendersTotalPages, page: tendersClamped } = pageSlice(groups, tendersPage);
  const { pageItems: bidPageItems, totalPages: bidsTotalPages, page: bidsClamped } = pageSlice(bids, bidsPage);

  return (
    <div className="d-flex flex-col gap-18px">
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
            {!tenderPageItems.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={6}>
                  No tenders in this filter.
                </td>
              </tr>
            ) : (
              tenderPageItems.map((g) => <TenderRow group={g} key={g.t.tender_id} />)
            )}
          </tbody>
        </table>
        <Pagination page={tendersClamped} totalPages={tendersTotalPages} onChange={setTendersPage} />
      </div>

      <div className="ep-pane">
        <div className="ep-pane-head">
          <span>Your Bids</span>
          <span className="ep-k">sealed until the deadline</span>
        </div>
        <table className="ep-table">
          <thead>
            <tr>
              {["Tender", "Line Item", "Qty", "Your Unit Price", "Status", "Outcome"].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!bidPageItems.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={6}>
                  No bids yet.
                </td>
              </tr>
            ) : (
              bidPageItems.map((b) => (
                <tr key={b.id}>
                  <td className="ep-cell">{b.tender_title}</td>
                  <td className="ep-cell">{b.product_name}</td>
                  <td className="ep-cell">{b.qty}</td>
                  <td className="ep-cell fw-700">{b.unit_price == null ? "—" : inr(b.unit_price)}</td>
                  <td className="ep-cell">
                    <StateTag state={bidDisplayStatus(b)} />
                  </td>
                  <td className="ep-cell fs-12-5px fw-600">{b.outcome ? b.outcome : <span className="ep-sub">{b.submitted_at ? "Awaiting result" : "—"}</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={bidsClamped} totalPages={bidsTotalPages} onChange={setBidsPage} />
      </div>
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
