import { showResult } from "../../ui.js";
import { kpiStrip as kpiTiles } from "../dashboard/kpi.js";
import { loadMappingData } from "./mappingData.js";
import { renderMappingList } from "./mappingList.js";

// ---- Mapping Requests (Module 2, 2026-10-08 -- split out of the old
// "Vendor Mapping" screen's in-page tab switcher into its own sidebar item,
// Vuexy's own User List look applied: stat cards, then the review queue
// table restyled with an avatar placeholder per vendor row. ----
const root = () => document.getElementById("mapping-requests-root");
const resultEl = () => document.getElementById("mapping-requests-result");

let data = null;
const filters = { state: "pending", scope: "" };

const STATE_OPTS = [["pending", "Pending"], ["approved", "Approved"], ["suspended", "Suspended"], ["rejected", "Rejected"], ["", "All"]];
const SCOPE_OPTS = [["", "Category & item"], ["category", "Category only"], ["item", "Item only"]];

function kpiStrip(mappings) {
  const count = (s) => mappings.filter((m) => m.state === s).length;
  return kpiTiles([
    ["Total mappings", mappings.length, "category & item mappings", null, "layers", "primary"],
    ["Pending", count("pending"), "awaiting your decision", null, "clock", "warning"],
    ["Approved", count("approved"), "eligible for tenders", null, "user-check", "success"],
    ["Suspended / rejected", count("suspended") + count("rejected"), "not eligible", null, "shield", "danger"],
  ]);
}

function render() {
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    ${kpiStrip(data.mappings)}
    <div class="ep-pane">
      <div class="ep-pane-head"><span>Mapping Requests</span>
        <span class="d-flex items-center gap-14px">
          <label class="ep-k">State&nbsp;<select class="input w-auto" id="list-state">${STATE_OPTS.map(([v, l]) => `<option value="${v}" ${v === filters.state ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="ep-k">Level&nbsp;<select class="input w-auto" id="list-scope">${SCOPE_OPTS.map(([v, l]) => `<option value="${v}" ${v === filters.scope ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </span></div>
      <div id="mapping-requests-table"></div>
    </div>
  </div>`;
  root().querySelector("#list-state").addEventListener("change", (e) => {
    filters.state = e.target.value;
    render();
  });
  root().querySelector("#list-scope").addEventListener("change", (e) => {
    filters.scope = e.target.value;
    render();
  });
  renderMappingList(document.getElementById("mapping-requests-table"), data, refresh, filters);
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

export function loadMappingRequests() {
  return refresh();
}
