import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, typeTag, stateTag, th, emptyRow, pageSlice, paginationBar, wirePagination } from "../../kit.js";
import { openItemForm } from "./itemForm.js";
import { openAssetForm } from "./assetForm.js";
import { openServiceForm } from "./serviceForm.js";
import { openCategoryForm } from "./categoryForm.js";
import { openSubCategoryForm } from "./subCategoryForm.js";
import { attrBits, priceBand } from "./attrSummary.js";
import { docLabel } from "../../constants.js";

// ---- Item, Asset & Service master (Module 2): the prototype's segment
// filter + catalogue table, with our create/edit forms opening above it. ----
const root = () => document.getElementById("catalog-root");
const host = () => document.getElementById("catalog-form-host");
const resultEl = () => document.getElementById("product-result");

let categories = [];
let subCategories = [];
let products = [];
let mappings = [];
let typeFilter = "all";
let productPage = 0;
let catalogTab = "items";
const expandedAttrs = new Set();
const ATTR_PREVIEW = 2;

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

function attrCell(p) {
  const bits = attrBits(p);
  if (!bits.length) return "—";
  const open = expandedAttrs.has(p.id);
  const shown = open ? bits : bits.slice(0, ATTR_PREVIEW);
  const toggle = bits.length > ATTR_PREVIEW ? ` <button class="ep-link" data-attrs="${p.id}">${open ? "Show less" : "Read more"}</button>` : "";
  return `${esc(shown.join(" · "))}${toggle}`;
}

function productRows() {
  const filtered = products.filter((p) => typeFilter === "all" || p.procurement_type === typeFilter);
  const { pageItems: shown, totalPages, page } = pageSlice(filtered, productPage);
  productPage = page;
  const rows = !shown.length
    ? emptyRow(8, "No catalog entries of this type yet.")
    : shown
        .map(
          (p) => `<tr>
        <td class="ep-cell ep-mono fs-11px nowrap">${esc(p.code)}</td>
        <td class="ep-cell"><div class="fw-600 ep-clip" title="${esc(p.name)}">${esc(p.name)}</div><div class="ep-sub ep-clip" title="${esc(p.description || "")}">${esc(p.description || "")}</div></td>
        <td class="ep-cell">${typeTag(p.procurement_type)}</td>
        <td class="ep-cell fs-12-5px">${esc(p.category)}${p.sub_category ? " › " + esc(p.sub_category) : ""}</td>
        <td class="ep-cell fs-11-5px text-ink-68 maxw-290px lh-1-45">${attrCell(p)}</td>
        <td class="ep-cell fs-12-5px nowrap">${esc(priceBand(p))}</td>
        <td class="ep-cell fw-800">${vendorCount(p)}</td>
        <td class="ep-cell nowrap text-right">
          ${p.active ? "" : stateTag("suspended") + " "}
          <button class="ep-b" data-edit="${p.id}">Edit</button>
          <button class="ep-b" data-toggle="${p.id}" data-action="${p.active ? "deactivate" : "activate"}">${p.active ? "Deactivate" : "Activate"}</button>
        </td></tr>`
        )
        .join("");
  return { rows, totalPages, page };
}

function render() {
  const tabs = [["items", "Items"], ["categories", "Categories"], ["subcategories", "Sub-categories"]];
  const typeSeg = [["all", "All types"], ["item", "Item"], ["asset", "Asset"], ["service", "Service"]];
  const count = products.filter((p) => typeFilter === "all" || p.procurement_type === typeFilter).length;
  const { rows: productRowsHtml, totalPages: productTotalPages, page: productPageClamped } = productRows();
  const newButtons = {
    items: `<button class="ep-b" data-v="p" data-new="item">+ New item</button><button class="ep-b" data-v="p" data-new="asset">+ New asset</button><button class="ep-b" data-v="p" data-new="service">+ New service</button>`,
    categories: `<button class="ep-b" data-new="category">+ New category</button>`,
    subcategories: `<button class="ep-b" data-new="subcategory">+ New sub-category</button>`,
  };
  const body = {
    items: `<div class="d-flex items-center gap-14px flex-wrap">
        <div class="ep-seg">${typeSeg.map(([k, l]) => `<button data-type="${k}" class="${k === typeFilter ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="hint flex-1">${count} entries · procurement type drives the line-item form and the mandatory attachment checklist</div>
      </div>
      <div class="ep-pane">
        <table class="ep-table">${th("Code", "Name &amp; specification", "Type", "Category", "Type-specific attributes", "Price band", "Vendors", "")}<tbody>${productRowsHtml}</tbody></table>
        ${paginationBar(productPageClamped, productTotalPages, "catalog-prev", "catalog-next")}
      </div>`,
    categories: `<div class="ep-pane">
        <div class="ep-pane-head"><span>Categories</span><span class="ep-k">restricted categories need a minimum vendor rating to map</span></div>
        <table class="ep-table">${th("Name", "Type", "Min rating for mapping", "")}<tbody>${
          categories.length
            ? categories
                .map(
                  (c) => `<tr><td class="ep-cell fw-600">${esc(c.name)}</td><td class="ep-cell">${typeTag(c.procurement_type)}</td>
                    <td class="ep-cell">${c.min_mapping_rating ?? "—"}${c.required_documents?.length ? `<div class="ep-sub">needs: ${c.required_documents.map(docLabel).join(", ")}</div>` : ""}</td>
                    <td class="ep-cell text-right"><button class="ep-b" data-edit-category="${c.id}">Edit</button></td></tr>`
                )
                .join("")
            : emptyRow(4, "No categories yet.")
        }</tbody></table>
      </div>`,
    subcategories: `<div class="ep-pane">
        <div class="ep-pane-head"><span>Sub-categories</span><span class="ep-k">used by the vendor-mapping drill-down</span></div>
        <table class="ep-table">${th("Name", "Category", "Type", "")}<tbody>${
          subCategories.length
            ? subCategories
                .map((s) => {
                  const c = categories.find((x) => x.id === s.category_id);
                  return `<tr><td class="ep-cell fw-600">${esc(s.name)}</td><td class="ep-cell">${esc(c?.name ?? "—")}</td><td class="ep-cell">${c ? typeTag(c.procurement_type) : "—"}</td>
                    <td class="ep-cell text-right"><button class="ep-b" data-edit-subcategory="${s.id}">Edit</button></td></tr>`;
                })
                .join("")
            : emptyRow(4, "No sub-categories yet.")
        }</tbody></table>
      </div>`,
  };
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    <div class="d-flex items-center gap-14px flex-wrap">
      <div class="ep-seg">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === catalogTab ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="flex-1"></div>
      ${newButtons[catalogTab]}
    </div>
    ${body[catalogTab]}
  </div>`;
  wire();
}

function wire() {
  const r = root();
  wirePagination(r, "catalog-prev", "catalog-next", productPage, (p) => {
    productPage = p;
    render();
  });
  r.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => ((catalogTab = b.dataset.tab), render())));
  r.querySelectorAll("[data-attrs]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = Number(b.dataset.attrs);
      if (expandedAttrs.has(id)) expandedAttrs.delete(id);
      else expandedAttrs.add(id);
      render();
    })
  );
  r.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => ((typeFilter = b.dataset.type), (productPage = 0), render())));
  r.querySelectorAll("[data-new]").forEach((b) =>
    b.addEventListener("click", () => {
      const kind = b.dataset.new;
      showForm(() => {
        if (kind === "category") return openCategoryForm(host(), null, afterSave, closeForm);
        if (kind === "subcategory") return openSubCategoryForm(host(), null, categories, afterSave, closeForm);
        return FORM_BY_TYPE[kind](host(), null, categories, subCategories, afterSave, closeForm);
      });
    })
  );
  r.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = products.find((x) => x.id === Number(b.dataset.edit));
      showForm(() => FORM_BY_TYPE[p.procurement_type](host(), p, categories, subCategories, afterSave, closeForm));
    })
  );
  r.querySelectorAll("[data-edit-category]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = categories.find((x) => x.id === Number(b.dataset.editCategory));
      showForm(() => openCategoryForm(host(), c, afterSave, closeForm));
    })
  );
  r.querySelectorAll("[data-edit-subcategory]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = subCategories.find((x) => x.id === Number(b.dataset.editSubcategory));
      showForm(() => openSubCategoryForm(host(), s, categories, afterSave, closeForm));
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
    [products, categories, subCategories, mappings] = await Promise.all([api("/products"), api("/categories"), api("/subcategories"), api("/mappings")]);
    render();
  } catch (err) {
    showResult(resultEl(), "Could not load catalog: " + err.message, false);
  }
}
