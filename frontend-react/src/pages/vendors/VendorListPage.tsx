import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import type { VendorListItem, VendorStatus } from "../../lib/types";
import { StateTag } from "../../components/Tag";
import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { Pagination, pageSlice } from "../../components/Pagination";
import { ImgPlaceholder } from "../../components/ImgPlaceholder";
import { setViewVendorId, switchView, takePendingListFilter } from "../../lib/bridge";

// Ported 1:1 from frontend/js/pages/vendorListPage.js -- Phase 2 of the
// React migration (see .claude-notes/REACT-MIGRATION-PLAN.md). The Vendor
// View screen it links to is still the vanilla vendorViewPage.js -- the
// deep-link handoff (setViewVendorId + switchView) goes through the window
// bridge in lib/bridge.ts, same shared storage vendorViewState.js itself now
// uses, so it works in both directions regardless of which page is React.
// preselectVendor() (the dashboard action queue's entry point into this
// same state) moved to vendorViewState.js -- it's not this file's export
// anymore the way it was in the vanilla version, since nothing outside this
// page needs to call into React code to use it.

const FILTERS: [VendorStatus | "", string][] = [
  ["pending_verification", "Pending"],
  ["info_requested", "Info requested"],
  ["active", "Active"],
  ["rejected", "Rejected"],
  ["suspended", "Suspended"],
  ["blacklisted", "Blacklisted"],
  ["", "All"],
];

export function VendorListPage() {
  const [allVendors, setAllVendors] = useState<VendorListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<VendorStatus | "">("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const pending = takePendingListFilter();
    if (pending !== null) setStatusFilter(pending as VendorStatus | "");
    try {
      setAllVendors(await api<VendorListItem[]>("/vendors"));
      setError("");
    } catch (err) {
      setError("Could not load vendors: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const count = (s: string) => allVendors.filter((v) => v.status === s).length;
  const kpis: KpiCell[] = [
    ["Total vendors", allVendors.length, "all registrations", null, "users", "primary"],
    ["Active", count("active"), "approved, can bid", null, "user-check", "success"],
    ["Needs review", count("pending_verification") + count("info_requested"), "pending verification or info requested", null, "clock", "warning"],
    ["Suspended / blacklisted", count("suspended") + count("blacklisted"), "blocked from bidding", null, "shield", "danger"],
  ];

  const filtered = statusFilter ? allVendors.filter((v) => v.status === statusFilter) : allVendors;
  const { pageItems, totalPages, page: clamped } = pageSlice(filtered, page);
  if (clamped !== page) setPage(clamped);

  const openVendor = (id: number) => {
    setViewVendorId(id);
    switchView("vendor-view");
  };

  return (
    <div className="d-flex flex-col gap-16px">
      <KpiStrip cells={kpis} />
      <div className="ep-pane">
        <div className="ep-pane-head">
          <span>Vendors</span>
          <span className="d-flex items-center gap-10px">
            <span className="ep-k">{filtered.length} shown</span>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as VendorStatus | "");
                setPage(0);
              }}
            >
              {FILTERS.map(([v, l]) => (
                <option value={v} key={v || "all"}>
                  {l}
                </option>
              ))}
            </select>
          </span>
        </div>
        <table className="ep-table">
          <thead>
            <tr>
              {["Vendor", "Contact", "Status", "Applied", ""].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={5}>
                  No vendors in this status.
                </td>
              </tr>
            ) : (
              pageItems.map((v) => (
                <tr key={v.id}>
                  <td className="ep-cell">
                    <div className="d-flex items-center gap-12px">
                      <ImgPlaceholder />
                      <div className="minw-0">
                        <div className="fw-600 ep-clip" title={v.legal_name}>
                          {v.legal_name}
                        </div>
                        <div className="ep-sub">V-{v.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="ep-cell fs-12-5px">{v.contact_person}</td>
                  <td className="ep-cell">
                    <StateTag state={v.status} />
                  </td>
                  <td className="ep-cell fs-12-5px">{fmtDate(v.created_at)}</td>
                  <td className="ep-cell text-right">
                    <button className="ep-b" onClick={() => openVendor(v.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
