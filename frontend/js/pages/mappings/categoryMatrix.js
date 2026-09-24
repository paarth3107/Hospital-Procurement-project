import { renderMatrixGrid } from "./matrixGrid.js";
import { openMappingDialog } from "./mappingDialog.js";

// Category Mapping tab: vendor x category. A cell is the vendor's
// category-level mapping only -- item-level mappings live on the Item tab.
export function renderCategoryMatrix(container, data, refresh) {
  if (data.vendors.length === 0 || data.categories.length === 0) {
    container.innerHTML = '<div class="ep-pane-pad hint">Add vendors and categories first.</div>';
    return;
  }
  const columns = data.categories.map((c) => ({
    key: c.id,
    label: c.name,
    sub: c.procurement_type + (c.min_mapping_rating != null ? ` · min rating ${c.min_mapping_rating}` : ""),
  }));

  renderMatrixGrid(container, {
    vendors: data.vendors,
    columns,
    legend: `<span><b style="color:#ae1800">MAPPED</b> — active, approved mapping</span>
      <span><b>PENDING</b> — vendor requested, review open</span>
      <span><b>SUSPENDED</b> / <b>REJECTED</b> — not eligible</span>
      <span>— not mapped. Click any cell for details.</span>`,
    getCell: (vendor, column) => {
      const m = data.categoryMappingOf(vendor.id, column.key);
      return { state: m ? m.state : "none" };
    },
    onClick: (vendor, column) =>
      openMappingDialog({
        data,
        vendor,
        kind: "category",
        target: data.categoryById.get(column.key),
        mapping: data.categoryMappingOf(vendor.id, column.key),
        onChanged: refresh,
      }),
  });
}
