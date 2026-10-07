import { showResult } from "../../ui.js";
import { loadMappingData } from "./mappingData.js";
import { renderMappingMatrix } from "./mappingMatrix.js";
import { renderMappingList } from "./mappingList.js";

// ---- Vendor mapping: the prototype's eligibility matrix, now a drill-down
// (Mapping matrix) plus a separate review queue (Mapping requests, 2026-10-01
// rework -- was a flat vendor x every-category/item grid, which doesn't scale
// to 100s of categories and 1000s of items). Category and item mappings are
// still separate rows with separate approvals underneath -- only how they're
// browsed changed. ----
const root = () => document.getElementById("mappings-root");
const resultEl = () => document.getElementById("mapping-result");

let data = null;
let tab = "matrix";
const listFilters = { state: "pending", scope: "" };

const TABS = [["matrix", "Mapping matrix"], ["list", "Mapping requests"]];

function skeleton() {
  const controls = {
    list: `<label class="ep-k">State&nbsp;<select class="input w-auto" id="list-state">${[["pending", "Pending"], ["approved", "Approved"], ["suspended", "Suspended"], ["rejected", "Rejected"], ["", "All"]]
      .map(([v, l]) => `<option value="${v}" ${v === listFilters.state ? "selected" : ""}>${l}</option>`)
      .join("")}</select></label>
      <label class="ep-k">Level&nbsp;<select class="input w-auto" id="list-scope">${[["", "Category & item"], ["category", "Category only"], ["item", "Item only"]]
      .map(([v, l]) => `<option value="${v}" ${v === listFilters.scope ? "selected" : ""}>${l}</option>`)
      .join("")}</select></label>`,
  };
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    <div class="fs-13px text-ink-70 maxw-900px lh-1-5">Many-to-many eligibility matrix — the single source of truth for who can be invited at tender time. Categories and items are mapped separately: an approved category mapping makes a vendor eligible for the items in it, and an item-level mapping can add to that or suspend one item. Click a cell to open the mapping's details — scope, history and the actions valid for its state.</div>
    <div class="d-flex items-center gap-14px flex-wrap">
      <div class="ep-seg">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
      ${controls[tab] || ""}
    </div>
    <div class="ep-pane overflow-auto" id="mapping-panel"></div>
  </div>`;
  root().querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => ((tab = b.dataset.tab), draw())));
  root().querySelector("#list-state")?.addEventListener("change", (e) => ((listFilters.state = e.target.value), draw()));
  root().querySelector("#list-scope")?.addEventListener("change", (e) => ((listFilters.scope = e.target.value), draw()));
}

function draw() {
  if (!data) return;
  skeleton();
  const panel = document.getElementById("mapping-panel");
  const empty = '<div class="ep-pane-pad hint">Add vendors and categories first.</div>';
  if (data.vendors.length === 0 || data.categories.length === 0) panel.innerHTML = empty;
  else if (tab === "matrix") renderMappingMatrix(panel, data, refresh);
  else renderMappingList(panel, data, refresh, listFilters);
}

async function refresh() {
  try {
    data = await loadMappingData();
    draw();
  } catch (err) {
    showResult(resultEl(), "Could not load mappings: " + err.message, false);
  }
}

export function loadMappingsPage() {
  return refresh();
}
