import { useState } from "react";
import { ImgPlaceholder } from "../../components/ImgPlaceholder";
import { StateTag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { MappingData } from "../../lib/mappingData";
import type { useMappingActions } from "./useMappingActions";

// Ported 1:1 from frontend/js/pages/mappings/mappingList.js -- "All
// mappings": every mapping row (category- and item-level), filtered by
// state and level, with the actions valid for each row's state. Vendor cell
// (avatar placeholder + name) and a combined Mapping cell (target + level
// subtitle) match the Vuexy-style table used by Vendor List / Product List.
export function MappingListTable({
  data,
  filters,
  actions,
}: {
  data: MappingData;
  filters: { state: string; scope: string };
  actions: ReturnType<typeof useMappingActions>;
}) {
  const [page, setPage] = useState(0);
  const filtered = data.mappings.filter((m) => {
    if (filters.state && m.state !== filters.state) return false;
    if (filters.scope === "category" && m.category_id == null) return false;
    if (filters.scope === "item" && m.product_master_id == null) return false;
    return true;
  });
  const { pageItems: rows, totalPages, page: clampedPage } = pageSlice(filtered, page);

  return (
    <>
      <table className="ep-table">
        <thead>
          <tr>
            {["Vendor", "Mapping", "State", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={4}>
                No mappings match.
              </td>
            </tr>
          ) : (
            rows.map((m) => {
              const vendor = data.vendorById.get(m.vendor_id);
              const isCategory = m.category_id != null;
              const target = isCategory ? data.categoryById.get(m.category_id!)?.name : data.productById.get(m.product_master_id!)?.name;
              const label = `${isCategory ? "category" : "item"} "${target}"`;
              return (
                <tr key={m.id}>
                  <td className="ep-cell">
                    <div className="d-flex items-center gap-12px">
                      <ImgPlaceholder iconName="image" size="sm" />
                      <div className="minw-0">
                        <div className="fw-600 ep-clip">{vendor ? vendor.legal_name : "—"}</div>
                        {vendor && <div className="ep-sub">V-{vendor.id}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="ep-cell">
                    {target || "—"}
                    <div className="ep-sub">{isCategory ? "Category" : "Item"}</div>
                  </td>
                  <td className="ep-cell">
                    <StateTag state={m.state} />
                  </td>
                  <td className="ep-cell text-right nowrap">
                    {m.state === "pending" && (
                      <>
                        <button className="ep-b" data-v="p" onClick={() => actions.approve(m.id)}>
                          Approve
                        </button>{" "}
                        <button className="ep-b" onClick={() => actions.reject(m.id)}>
                          Reject
                        </button>
                      </>
                    )}
                    {m.state === "approved" && vendor && (
                      <button className="ep-b" onClick={() => actions.suspend(m.id, vendor, label)}>
                        Suspend
                      </button>
                    )}
                    {m.state === "suspended" && vendor && (
                      <button className="ep-b" data-v="p" onClick={() => actions.reinstate(m.id, vendor, label)}>
                        Reinstate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <Pagination page={clampedPage} totalPages={totalPages} onChange={setPage} />
    </>
  );
}
