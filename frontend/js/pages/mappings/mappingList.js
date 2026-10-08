import { esc, stateTag, th, emptyRow, pageSlice, paginationBar, wirePagination, imgPlaceholder } from "../../kit.js";
import { approveMapping, rejectMapping, suspendMapping, reinstateMapping } from "./mappingActions.js";

// "All mappings": every mapping row (category- and item-level), filtered by
// state and level, with the actions valid for each row's state. Vendor cell
// (avatar placeholder + name) and a combined Mapping cell (target + level
// subtitle) match the Vuexy-style table used by Vendor List / Product List.
let page = 0;

export function renderMappingList(container, data, refresh, filters) {
  const filtered = data.mappings.filter((m) => {
    if (filters.state && m.state !== filters.state) return false;
    if (filters.scope === "category" && m.category_id == null) return false;
    if (filters.scope === "item" && m.product_master_id == null) return false;
    return true;
  });
  const { pageItems: rows, totalPages, page: clamped } = pageSlice(filtered, page);
  page = clamped;

  container.innerHTML = `<table class="ep-table">${th("Vendor", "Mapping", "State", "")}<tbody>${
    rows.length
      ? rows
          .map((m, i) => {
            const vendor = data.vendorById.get(m.vendor_id);
            const isCategory = m.category_id != null;
            const target = isCategory ? data.categoryById.get(m.category_id)?.name : data.productById.get(m.product_master_id)?.name;
            const acts = {
              pending: [["Approve", "approve", true], ["Reject", "reject"]],
              approved: [["Suspend", "suspend"]],
              suspended: [["Reinstate", "reinstate", true]],
            }[m.state] || [];
            return `<tr>
              <td class="ep-cell">
                <div class="d-flex items-center gap-12px">
                  ${imgPlaceholder("image", "sm")}
                  <div class="minw-0">
                    <div class="fw-600 ep-clip">${esc(vendor ? vendor.legal_name : "—")}</div>
                    ${vendor ? `<div class="ep-sub">V-${vendor.id}</div>` : ""}
                  </div>
                </div>
              </td>
              <td class="ep-cell">${esc(target || "—")}<div class="ep-sub">${isCategory ? "Category" : "Item"}</div></td>
              <td class="ep-cell">${stateTag(m.state)}</td>
              <td class="ep-cell text-right nowrap">${acts
                .map(([label, act, primary]) => `<button class="ep-b"${primary ? ' data-v="p"' : ""} data-row="${i}" data-act="${act}">${label}</button>`)
                .join(" ")}</td>
            </tr>`;
          })
          .join("")
      : emptyRow(4, "No mappings match.")
  }</tbody></table>
  ${paginationBar(page, totalPages, "mapping-list-prev", "mapping-list-next")}`;

  wirePagination(container, "mapping-list-prev", "mapping-list-next", page, (p) => {
    page = p;
    renderMappingList(container, data, refresh, filters);
  });
  container.querySelectorAll("button[data-act]").forEach((b) =>
    b.addEventListener("click", async () => {
      const m = rows[Number(b.dataset.row)];
      const vendor = data.vendorById.get(m.vendor_id);
      const isCategory = m.category_id != null;
      const name = isCategory ? data.categoryById.get(m.category_id)?.name : data.productById.get(m.product_master_id)?.name;
      const label = `${isCategory ? "category" : "item"} "${name}"`;
      const actions = {
        approve: () => approveMapping(m),
        reject: () => rejectMapping(m),
        suspend: () => suspendMapping(m, vendor, label),
        reinstate: () => reinstateMapping(m, vendor, label),
      };
      if (await actions[b.dataset.act]()) refresh();
    })
  );
}
