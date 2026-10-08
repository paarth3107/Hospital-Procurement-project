import { showResult } from "../../ui.js";
import { loadMappingData } from "./mappingData.js";
import { renderMappingMatrix } from "./mappingMatrix.js";

// ---- Mapping Matrix (Module 2, 2026-10-08 -- split out of the old
// "Vendor Mapping" screen's in-page tab switcher into its own sidebar item,
// same treatment as Catalog and Vendor List/View). Pick a vendor, drill
// Type -> Category -> Sub-category, see that vendor's mapping status
// against every item -- a drill-down tool, not a list, so it keeps its own
// screen rather than being folded into Mapping Requests. ----
const root = () => document.getElementById("mapping-matrix-root");
const resultEl = () => document.getElementById("mapping-matrix-result");

let data = null;

function render() {
  const empty = data.vendors.length === 0 || data.categories.length === 0;
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    <div class="ep-pane overflow-auto" id="mapping-matrix-panel">${empty ? '<div class="ep-pane-pad hint">Add vendors and categories first.</div>' : ""}</div>
  </div>`;
  if (!empty) renderMappingMatrix(document.getElementById("mapping-matrix-panel"), data, refresh);
}

async function refresh() {
  try {
    data = await loadMappingData();
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load mappings: " + err.message, false);
  }
}

export function loadMappingMatrix() {
  return refresh();
}
