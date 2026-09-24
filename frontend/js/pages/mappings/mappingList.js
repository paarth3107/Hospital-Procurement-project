import { esc, stateTag, th, emptyRow } from "../../kit.js";
import { approveMapping, rejectMapping, suspendMapping, reinstateMapping } from "./mappingActions.js";

// "All mappings": every mapping row (category- and item-level), filtered by
// state and level, with the actions valid for each row's state.
export function renderMappingList(container, data, refresh, filters) {
  const rows = data.mappings.filter((m) => {
    if (filters.state && m.state !== filters.state) return false;
    if (filters.scope === "category" && m.category_id == null) return false;
    if (filters.scope === "item" && m.product_master_id == null) return false;
    return true;
  });

  container.innerHTML = `<table class="ep-table">${th("Vendor", "Level", "Target", "State", "")}<tbody>${
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
              <td class="ep-cell" style="font-weight:600">${esc(vendor ? vendor.legal_name : "—")}</td>
              <td class="ep-cell">${isCategory ? "Category" : "Item"}</td>
              <td class="ep-cell">${esc(target || "—")}</td>
              <td class="ep-cell">${stateTag(m.state)}</td>
              <td class="ep-cell" style="text-align:right;white-space:nowrap">${acts
                .map(([label, act, primary]) => `<button class="ep-b"${primary ? ' data-v="p"' : ""} data-row="${i}" data-act="${act}">${label}</button>`)
                .join(" ")}</td>
            </tr>`;
          })
          .join("")
      : emptyRow(5, "No mappings match.")
  }</tbody></table>`;

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
