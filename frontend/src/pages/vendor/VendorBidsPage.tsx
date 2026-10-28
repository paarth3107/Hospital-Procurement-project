import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { inr } from "../../lib/format";
import { StateTag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { MyBid } from "../../lib/types";

// Split out of VendorTendersPage.tsx (2026-10-28, user-directed): "Tenders"
// in the sidebar used to be one tab showing both the Tender Invitations
// table and this one stacked on the same page -- now its own tab,
// VendorInvitationsPage.tsx the other. The Dashboard keeps its own KPI
// strip and a "Latest 5" preview of this same table (VendorDashboardPage.
// tsx's BidsPreview), not a second copy of the whole thing.

// Real bug, found 2026-10-14 (VendorDashboardPage.tsx): the Status column
// always showed the bid DOCUMENT's own lifecycle status (draft/submitted/
// withdrawn -- it was submitted and never withdrawn, which stays true
// forever), while a separate Outcome column showed the award result once
// known -- so an awarded bid displayed "Submitted" right next to "Awarded".
// Once outcome is known, show it as the Status tag too. Exported so
// VendorDashboardPage.tsx's own "Latest 5 bids" preview reuses this exact
// mapping instead of a second, driftable copy of it.
export function bidDisplayStatus(b: MyBid): string {
  if (b.outcome?.startsWith("Awarded")) return "awarded";
  if (b.outcome === "Not selected") return "no_award";
  if (b.outcome === "Technically disqualified") return "disqualified";
  return b.status;
}

export function VendorBidsPage() {
  const [bids, setBids] = useState<MyBid[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try {
      setBids(await api<MyBid[]>("/vendor-portal/bids"));
      setError("");
    } catch (err) {
      setError("Could not load bids: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !bids.length) return <div className="result err">{error}</div>;

  const { pageItems, totalPages, page: clamped } = pageSlice(bids, page);

  return (
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
          {!pageItems.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={6}>
                No bids yet.
              </td>
            </tr>
          ) : (
            pageItems.map((b) => (
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
      <Pagination page={clamped} totalPages={totalPages} onChange={setPage} />
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
