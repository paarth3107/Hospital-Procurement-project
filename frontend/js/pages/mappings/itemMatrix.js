import { renderMatrixGrid } from "./matrixGrid.js";
import { openMappingDialog } from "./mappingDialog.js";

// Item Mapping tab: pick a category, then vendor x item within it. A cell is
// the vendor's item-level mapping only; clicking any cell opens its detail dialog, where
// a blank cell can be mapped and approved directly. Suspending an item does not touch
// the vendor's category mapping unless it was the last eligible item in the
// category (backend: services/mappings.py after_item_suspended).
export function renderItemMatrix(container, data, categoryId, refresh) {
  const products = data.products.filter((p) => p.category_id === categoryId);
  if (data.vendors.length === 0 || products.length === 0) {
    container.innerHTML = '<div class="ep-pane-pad hint">No items in this category yet, or no vendors.</div>';
    return;
  }
  const columns = products.map((p) => ({
    key: p.id,
    label: p.name,
    sub: p.code + (p.min_mapping_rating != null ? ` · min rating ${p.min_mapping_rating}` : ""),
  }));

  renderMatrixGrid(container, {
    vendors: data.vendors,
    columns,
    legend: `<span><b style="color:#ae1800">MAPPED</b> — active, approved mapping</span>
      <span><b>PENDING</b> — vendor requested, review open</span>
      <span><b>SUSPENDED</b> / <b>REJECTED</b> — not eligible</span>
      <span>— not mapped. Click any cell for details.</span>`,
    getCell: (vendor, column) => {
      const m = data.itemMappingOf(vendor.id, column.key);
      return { state: m ? m.state : "none" };
    },
    onClick: (vendor, column) =>
      openMappingDialog({
        data,
        vendor,
        kind: "item",
        target: data.productById.get(column.key),
        mapping: data.itemMappingOf(vendor.id, column.key),
        onChanged: refresh,
      }),
  });
}
