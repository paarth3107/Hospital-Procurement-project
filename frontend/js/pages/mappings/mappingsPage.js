import { showResult } from "../../ui.js";
import { esc } from "../../kit.js";
import { loadMappingData } from "./mappingData.js";
import { renderCategoryMatrix } from "./categoryMatrix.js";
import { renderItemMatrix } from "./itemMatrix.js";
import { renderMappingList } from "./mappingList.js";

// ---- Vendor mapping: the prototype's eligibility matrix, with a segment
// control for its three views (category mapping, item mapping, all mappings).
// Category and item mappings are separate rows with separate approvals. ----
const root = () => document.getElementById("mappings-root");
const resultEl = () => document.getElementById("mapping-result");

let data = null;
let tab = "category";
let itemCategoryId = null;
const listFilters = { state: "pending", scope: "" };

const TABS = [["category", "Category mapping"], ["item", "Item mapping"], ["list", "All mappings"]];

function skeleton() {
  const controls = {
    item: `<label class="ep-k">Category&nbsp;<select class="input" id="item-category" style="width:auto;min-width:220px">${data.categories
      .map((c) => `<option value="${c.id}" ${c.id === itemCategoryId ? "selected" : ""}>${esc(c.name)} (${esc(c.procurement_type)})</option>`)
      .join("")}</select></label>`,
    list: `<label class="ep-k">State&nbsp;<select class="input" id="list-state" style="width:auto">${[["pending", "Pending"], ["approved", "Approved"], ["suspended", "Suspended"], ["rejected", "Rejected"], ["", "All"]]
      .map(([v, l]) => `<option value="${v}" ${v === listFilters.state ? "selected" : ""}>${l}</option>`)
      .join("")}</select></label>
      <label class="ep-k">Level&nbsp;<select class="input" id="list-scope" style="width:auto">${[["", "Category & item"], ["category", "Category only"], ["item", "Item only"]]
      .map(([v, l]) => `<option value="${v}" ${v === listFilters.scope ? "selected" : ""}>${l}</option>`)
      .join("")}</select></label>`,
  };
  root().innerHTML = `<div style="display:flex;flex-direction:column;gap:16px">
    <div style="font-size:13px;color:rgba(32,30,29,.7);max-width:900px;line-height:1.5">Many-to-many eligibility matrix — the single source of truth for who can be invited at tender time. Categories and items are mapped separately: an approved category mapping makes a vendor eligible for the items in it, and an item-level mapping can add to that or suspend one item. Click a cell to open the mapping's details — scope, history and the actions valid for its state.</div>
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div class="ep-seg">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
      ${controls[tab] || ""}
    </div>
    <div class="ep-pane" id="mapping-panel" style="overflow:auto"></div>
  </div>`;
  root().querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => ((tab = b.dataset.tab), draw())));
  root().querySelector("#item-category")?.addEventListener("change", (e) => ((itemCategoryId = Number(e.target.value)), draw()));
  root().querySelector("#list-state")?.addEventListener("change", (e) => ((listFilters.state = e.target.value), draw()));
  root().querySelector("#list-scope")?.addEventListener("change", (e) => ((listFilters.scope = e.target.value), draw()));
}

function draw() {
  if (!data) return;
  if (!data.categoryById.has(itemCategoryId)) itemCategoryId = data.categories[0]?.id ?? null;
  skeleton();
  const panel = document.getElementById("mapping-panel");
  const empty = '<div class="ep-pane-pad hint">Add vendors and categories first.</div>';
  if (data.vendors.length === 0 || data.categories.length === 0) panel.innerHTML = empty;
  else if (tab === "category") renderCategoryMatrix(panel, data, refresh);
  else if (tab === "item") renderItemMatrix(panel, data, itemCategoryId, refresh);
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
