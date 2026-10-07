import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, tag, typeTag, th, emptyRow, pageSlice, paginationBar, wirePagination, imgPlaceholder } from "../../kit.js";
import { openItemForm } from "./itemForm.js";
import { openAssetForm } from "./assetForm.js";
import { openServiceForm } from "./serviceForm.js";
import { openCategoryForm } from "./categoryForm.js";
import { openSubCategoryForm } from "./subCategoryForm.js";
import { attrBits, priceBand } from "./attrSummary.js";
import { docLabel } from "../../constants.js";

// ---- Item, Asset & Service master (Module 2): laid out like Vuexy's own
// eCommerce > Products section (Product List / Add Product / Category List,
// 2026-10-07) -- Sub-Category List is a 4th tab alongside those three, since
// this app has a concept Vuexy's own demo doesn't. Add Product replaces the
// old pattern of an inline create/edit form toggling in below the list --
// it's its own tab now, the same way Vuexy's is its own page, and doubles as
// the edit screen (clicking Edit on a list row opens it there, pre-filled).
const root = () => document.getElementById("catalog-root");
const host = () => document.getElementById("catalog-form-host"); // category/sub-category inline forms only -- see below
const resultEl = () => document.getElementById("product-result");

let categories = [];
let subCategories = [];
let products = [];
let mappings = [];
let typeFilter = "all";
let productPage = 0;
let catalogTab = "list";
let editingProduct = null; // set while the Add Product tab is actually editing an existing entry
let addType = "item"; // which type's blank form the Add Product tab shows when creating new
const expandedAttrs = new Set();
const ATTR_PREVIEW = 2;

const FORM_BY_TYPE = { item: openItemForm, asset: openAssetForm, service: openServiceForm };
const TYPE_OPTS = [["item", "Item"], ["asset", "Asset"], ["service", "Service"]];

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
        <td class="ep-cell">
          <div class="d-flex items-center gap-12px">
            ${imgPlaceholder("image", "sm")}
            <div class="minw-0">
              <div class="fw-600 ep-clip" title="${esc(p.name)}">${esc(p.name)}</div>
              <div class="ep-sub ep-mono fs-11px">${esc(p.code)}</div>
            </div>
          </div>
        </td>
        <td class="ep-cell fs-12-5px">${esc(p.category)}${p.sub_category ? `<div class="ep-sub">${esc(p.sub_category)}</div>` : ""}</td>
        <td class="ep-cell">${typeTag(p.procurement_type)}</td>
        <td class="ep-cell fs-11-5px text-ink-68 maxw-290px lh-1-45">${attrCell(p)}</td>
        <td class="ep-cell fs-12-5px nowrap">${esc(priceBand(p))}</td>
        <td class="ep-cell fw-800">${vendorCount(p)}</td>
        <td class="ep-cell">${p.active ? tag("Active", "pos") : tag("Inactive", "neg")}</td>
        <td class="ep-cell nowrap text-right">
          <button class="ep-b" data-edit="${p.id}">Edit</button>
          <button class="ep-b" data-toggle="${p.id}" data-action="${p.active ? "deactivate" : "activate"}">${p.active ? "Deactivate" : "Activate"}</button>
        </td></tr>`
        )
        .join("");
  return { rows, totalPages, page };
}

// Category List tab: a card per category (Vuexy's ecommerce category grid),
// not a table row -- the image placeholder is where a real category photo
// lands later, same as the product list's.
function categoryCards() {
  if (!categories.length) return `<div class="ep-pane ep-pane-pad hint">No categories yet.</div>`;
  return `<div class="ep-grid grid-cols-repeatauto-fitminmax260px1fr">${categories
    .map((c) => {
      const count = products.filter((p) => p.category_id === c.id).length;
      return `<div class="ep-category-card">
        <div class="ep-category-card-head">
          ${imgPlaceholder("tag", "md")}
          <div class="minw-0">
            <div class="fw-700 fs-15px ep-clip" title="${esc(c.name)}">${esc(c.name)}</div>
            <div class="ep-sub">${count} item(s)</div>
          </div>
        </div>
        <div class="d-flex items-center gap-8px flex-wrap">${typeTag(c.procurement_type)}${c.min_mapping_rating != null ? tag(`Min rating ${c.min_mapping_rating}`, "att") : ""}</div>
        ${c.required_documents?.length ? `<div class="ep-sub">Needs: ${esc(c.required_documents.map(docLabel).join(", "))}</div>` : ""}
        <div><button class="ep-b" data-edit-category="${c.id}">Edit</button></div>
      </div>`;
    })
    .join("")}</div>`;
}

function render() {
  const tabs = [["list", "Product List"], ["add", "Add Product"], ["categories", "Category List"], ["subcategories", "Sub-Category List"]];
  const typeSeg = [["all", "All types"], ["item", "Item"], ["asset", "Asset"], ["service", "Service"]];
  const count = products.filter((p) => typeFilter === "all" || p.procurement_type === typeFilter).length;
  const { rows: productRowsHtml, totalPages: productTotalPages, page: productPageClamped } = productRows();
  const newButtons = {
    list: `<button class="ep-b" data-v="p" data-goto-add>+ Add Product</button>`,
    add: "",
    categories: `<button class="ep-b" data-new="category">+ New category</button>`,
    subcategories: `<button class="ep-b" data-new="subcategory">+ New sub-category</button>`,
  };
  const body = {
    list: `<div class="d-flex items-center gap-14px flex-wrap">
        <div class="ep-seg">${typeSeg.map(([k, l]) => `<button data-type="${k}" class="${k === typeFilter ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="hint flex-1">${count} entries · procurement type drives the line-item form and the mandatory attachment checklist</div>
      </div>
      <div class="ep-pane">
        <table class="ep-table">${th("Product", "Category", "Type", "Type-specific attributes", "Price band", "Vendors", "Status", "")}<tbody>${productRowsHtml}</tbody></table>
        ${paginationBar(productPageClamped, productTotalPages, "catalog-prev", "catalog-next")}
      </div>`,
    // Same screen for create and edit, like Vuexy's own Add Product page --
    // editing a row just opens this tab pre-filled instead of a separate form.
    add: `<div class="d-flex items-baseline gap-14px flex-wrap">
        <span class="fs-18px fw-800">${editingProduct ? `Edit ${esc(editingProduct.name)}` : "Add a new catalog entry"}</span>
        ${editingProduct ? typeTag(editingProduct.procurement_type) : ""}
      </div>
      ${
        editingProduct
          ? ""
          : `<div class="ep-seg self-start">${TYPE_OPTS.map(([k, l]) => `<button data-add-type="${k}" class="${k === addType ? "on" : ""}">${l}</button>`).join("")}</div>`
      }
      <div id="catalog-add-form-host"></div>`,
    categories: `<div class="d-flex flex-col gap-16px">
        <div class="hint">restricted categories need a minimum vendor rating to map</div>
        ${categoryCards()}
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
  if (catalogTab === "add") renderAddProductForm();
}

// The Add Product tab's actual form, rendered imperatively into its own
// sub-host (same reasoning as the officer dashboard's donut chart div --
// the surrounding tab chrome is declarative, the form itself isn't).
function renderAddProductForm() {
  const addHost = document.getElementById("catalog-add-form-host");
  if (!addHost) return;
  const onSaved = (message) => {
    editingProduct = null;
    catalogTab = "list";
    showResult(resultEl(), message, true);
    loadProducts();
  };
  const onCancel = () => {
    editingProduct = null;
    catalogTab = "list";
    render();
  };
  const type = editingProduct ? editingProduct.procurement_type : addType;
  FORM_BY_TYPE[type](addHost, editingProduct, categories, subCategories, onSaved, onCancel);
}

function wire() {
  const r = root();
  wirePagination(r, "catalog-prev", "catalog-next", productPage, (p) => {
    productPage = p;
    render();
  });
  r.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      catalogTab = b.dataset.tab;
      if (catalogTab !== "add") editingProduct = null;
      render();
    })
  );
  r.querySelector("[data-goto-add]")?.addEventListener("click", () => {
    editingProduct = null;
    catalogTab = "add";
    render();
  });
  r.querySelectorAll("[data-add-type]").forEach((b) =>
    b.addEventListener("click", () => {
      addType = b.dataset.addType;
      render();
    })
  );
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
        return openSubCategoryForm(host(), null, categories, afterSave, closeForm);
      });
    })
  );
  r.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      editingProduct = products.find((x) => x.id === Number(b.dataset.edit));
      catalogTab = "add";
      render();
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
