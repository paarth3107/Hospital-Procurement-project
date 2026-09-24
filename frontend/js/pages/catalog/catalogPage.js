import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, typeTag, stateTag, th, emptyRow } from "../../kit.js";
import { openItemForm } from "./itemForm.js";
import { openAssetForm } from "./assetForm.js";
import { openServiceForm } from "./serviceForm.js";
import { openCategoryForm } from "./categoryForm.js";
import { attrSummary, priceBand } from "./attrSummary.js";

// ---- Item, Asset & Service master (Module 2): the prototype's segment
// filter + catalogue table, with our create/edit forms opening above it. ----
const root = () => document.getElementById("catalog-root");
const host = () => document.getElementById("catalog-form-host");
const resultEl = () => document.getElementById("product-result");

let categories = [];
let products = [];
let mappings = [];
let typeFilter = "all";

const FORM_BY_TYPE = { item: openItemForm, asset: openAssetForm, service: openServiceForm };

function closeForm() {
  host().hidden = true;
  host().innerHTML = "";
}

function afterSave(message) {
  closeForm();
  showResult(resultEl(), message, true);
  loadProducts();
}

function showForm(open) {
  open();
  host().scrollIntoView({ behavior: "smooth", block: "start" });
}

// Vendors currently eligible for an entry: approved item mapping, or an
// approved category mapping, unless an item-level suspension/rejection says no
// (same rule as the eligibility resolver).
function vendorCount(p) {
  const blocked = new Set();
  const allowed = new Set();
  for (const m of mappings) {
    if (m.product_master_id === p.id) {
      if (m.state === "approved") allowed.add(m.vendor_id);
      else if (["suspended", "rejected"].includes(m.state)) blocked.add(m.vendor_id);
    } else if (m.category_id === p.category_id && m.state === "approved") {
      allowed.add(m.vendor_id);
    }
  }
  return [...allowed].filter((v) => !blocked.has(v)).length;
}

function productRows() {
  const shown = products.filter((p) => typeFilter === "all" || p.procurement_type === typeFilter);
  if (!shown.length) return emptyRow(8, "No catalog entries of this type yet.");
  return shown
    .map(
      (p) => `<tr>
        <td class="ep-cell ep-mono" style="font-size:12px">${esc(p.code)}</td>
        <td class="ep-cell"><div style="font-weight:600">${esc(p.name)}</div><div class="ep-sub">${esc(p.description || "")}</div></td>
        <td class="ep-cell">${typeTag(p.procurement_type)}</td>
        <td class="ep-cell" style="font-size:12.5px">${esc(p.category)}${p.sub_category ? " › " + esc(p.sub_category) : ""}</td>
        <td class="ep-cell" style="font-size:11.5px;color:rgba(32,30,29,.68);max-width:290px;line-height:1.45">${esc(attrSummary(p))}</td>
        <td class="ep-cell" style="font-size:12.5px;white-space:nowrap">${esc(priceBand(p))}</td>
        <td class="ep-cell" style="font-weight:800">${vendorCount(p)}</td>
        <td class="ep-cell" style="white-space:nowrap;text-align:right">
          ${p.active ? "" : stateTag("suspended") + " "}
          <button class="ep-b" data-edit="${p.id}">Edit</button>
          <button class="ep-b" data-toggle="${p.id}" data-action="${p.active ? "deactivate" : "activate"}">${p.active ? "Deactivate" : "Activate"}</button>
        </td></tr>`
    )
    .join("");
}

function render() {
  const count = products.filter((p) => typeFilter === "all" || p.procurement_type === typeFilter).length;
  const seg = [["all", "All types"], ["item", "Item"], ["asset", "Asset"], ["service", "Service"]];
  root().innerHTML = `<div style="display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div class="ep-seg">${seg.map(([k, l]) => `<button data-type="${k}" class="${k === typeFilter ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="hint" style="flex:1">${count} entries · procurement type drives the line-item form and the mandatory attachment checklist</div>
      <button class="ep-b" data-v="p" data-new="item">+ New item</button>
      <button class="ep-b" data-v="p" data-new="asset">+ New asset</button>
      <button class="ep-b" data-v="p" data-new="service">+ New service</button>
      <button class="ep-b" data-new="category">+ New category</button>
    </div>
    <div class="ep-pane">
      <table class="ep-table">${th("Code", "Name &amp; specification", "Type", "Category", "Type-specific attributes", "Price band", "Vendors", "")}<tbody>${productRows()}</tbody></table>
    </div>
    <div class="ep-pane">
      <div class="ep-pane-head"><span>Categories</span><span class="ep-k">restricted categories need a minimum vendor rating to map</span></div>
      <table class="ep-table">${th("Name", "Type", "Min rating for mapping", "")}<tbody>${
        categories.length
          ? categories
              .map(
                (c) => `<tr><td class="ep-cell" style="font-weight:600">${esc(c.name)}</td><td class="ep-cell">${typeTag(c.procurement_type)}</td>
                  <td class="ep-cell">${c.min_mapping_rating ?? "—"}</td>
                  <td class="ep-cell" style="text-align:right"><button class="ep-b" data-edit-category="${c.id}">Edit</button></td></tr>`
              )
              .join("")
          : emptyRow(4, "No categories yet.")
      }</tbody></table>
    </div>
  </div>`;
  wire();
}

function wire() {
  const r = root();
  r.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => ((typeFilter = b.dataset.type), render())));
  r.querySelectorAll("[data-new]").forEach((b) =>
    b.addEventListener("click", () => {
      const kind = b.dataset.new;
      showForm(() => (kind === "category" ? openCategoryForm(host(), null, afterSave, closeForm) : FORM_BY_TYPE[kind](host(), null, categories, afterSave, closeForm)));
    })
  );
  r.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = products.find((x) => x.id === Number(b.dataset.edit));
      showForm(() => FORM_BY_TYPE[p.procurement_type](host(), p, categories, afterSave, closeForm));
    })
  );
  r.querySelectorAll("[data-edit-category]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = categories.find((x) => x.id === Number(b.dataset.editCategory));
      showForm(() => openCategoryForm(host(), c, afterSave, closeForm));
    })
  );
  r.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api(`/products/${b.dataset.toggle}/${b.dataset.action}`, { method: "POST" });
        loadProducts();
      } catch (err) {
        showResult(resultEl(), `Could not ${b.dataset.action} catalog entry: ` + err.message, false);
      }
    })
  );
}

export async function loadProducts() {
  try {
    [products, categories, mappings] = await Promise.all([api("/products"), api("/categories"), api("/mappings")]);
    render();
  } catch (err) {
    showResult(resultEl(), "Could not load catalog: " + err.message, false);
  }
}
