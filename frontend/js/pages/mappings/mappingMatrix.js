import { esc } from "../../kit.js";
import { openMappingDialog } from "./mappingDialog.js";

// Mapping matrix tab (2026-10-01 rework, then corrected same day): pick a
// vendor first, then drill Type -> Category -> Sub-category, and see that one
// vendor's mapping status against every item in the sub-category as a plain
// list (tick/dash) -- not a vendor x item grid. A vendor x item grid still
// grows one axis with catalog size (1000s of items); pinning the vendor and
// listing items vertically is the one that actually stays readable at that
// scale. Clicking any row still opens the same detail dialog as before.
let selVendorId = null;
let selType = null;
let selCategoryId = null;
let selSubCategoryId = null;

export function renderMappingMatrix(container, data, refresh) {
  if (!data.vendors.some((v) => v.id === selVendorId)) selVendorId = data.vendors[0]?.id ?? null;
  const types = [...new Set(data.categories.map((c) => c.procurement_type))];
  if (!selType || !types.includes(selType)) selType = types[0] ?? null;
  const categoriesOfType = data.categories.filter((c) => c.procurement_type === selType);
  if (!categoriesOfType.some((c) => c.id === selCategoryId)) selCategoryId = categoriesOfType[0]?.id ?? null;
  const subCategoriesOfCategory = data.subCategories.filter((s) => s.category_id === selCategoryId);
  if (!subCategoriesOfCategory.some((s) => s.id === selSubCategoryId)) selSubCategoryId = null;

  container.innerHTML = `
    <div class="padding-14px-16px d-flex gap-14px flex-wrap items-center border-bottom-1px-solid-ink-18">
      <label class="ep-k">Vendor&nbsp;<select class="input w-auto minw-220px" id="mm-vendor">${data.vendors
        .map((v) => `<option value="${v.id}" ${v.id === selVendorId ? "selected" : ""}>${esc(v.legal_name)}</option>`)
        .join("")}</select></label>
      <label class="ep-k">Type&nbsp;<select class="input w-auto" id="mm-type">${types
        .map((t) => `<option value="${t}" ${t === selType ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`)
        .join("")}</select></label>
      <label class="ep-k">Category&nbsp;<select class="input w-auto minw-220px" id="mm-category">${categoriesOfType
        .map((c) => `<option value="${c.id}" ${c.id === selCategoryId ? "selected" : ""}>${esc(c.name)}</option>`)
        .join("")}</select></label>
      <label class="ep-k">Sub-category&nbsp;<select class="input w-auto minw-220px" id="mm-subcategory" ${subCategoriesOfCategory.length ? "" : "disabled"}>
        <option value="">All</option>
        ${subCategoriesOfCategory.map((s) => `<option value="${s.id}" ${s.id === selSubCategoryId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
      </select></label>
    </div>
    <div id="mm-body"></div>`;

  container.querySelector("#mm-vendor").addEventListener("change", (e) => {
    selVendorId = Number(e.target.value);
    renderMappingMatrix(container, data, refresh);
  });
  container.querySelector("#mm-type").addEventListener("change", (e) => {
    selType = e.target.value;
    selCategoryId = null;
    selSubCategoryId = null;
    renderMappingMatrix(container, data, refresh);
  });
  container.querySelector("#mm-category").addEventListener("change", (e) => {
    selCategoryId = Number(e.target.value);
    selSubCategoryId = null;
    renderMappingMatrix(container, data, refresh);
  });
  container.querySelector("#mm-subcategory").addEventListener("change", (e) => {
    selSubCategoryId = e.target.value ? Number(e.target.value) : null;
    renderMappingMatrix(container, data, refresh);
  });

  renderBody(container.querySelector("#mm-body"), data, refresh);
}

const mark = (state) => (state === "approved" ? "✓" : "—");
const markState = (state) => (state === "approved" ? "approved" : "none");

function statusButton(state, extraAttrs = "") {
  return `<button class="matrix-btn w-60px h-32px" data-s="${markState(state)}" ${extraAttrs}>${mark(state)}</button>`;
}

function renderBody(body, data, refresh) {
  const vendor = data.vendorById.get(selVendorId);
  if (!vendor || !selCategoryId) {
    body.innerHTML = '<div class="ep-pane-pad hint">Add vendors and categories first.</div>';
    return;
  }
  const category = data.categoryById.get(selCategoryId);
  const categoryMapping = data.categoryMappingOf(vendor.id, category.id);
  const categoryState = categoryMapping ? categoryMapping.state : "none";

  const items = selSubCategoryId ? data.products.filter((p) => p.sub_category_id === selSubCategoryId) : data.products.filter((p) => p.category_id === selCategoryId);
  const itemSectionLabel = selSubCategoryId ? data.subCategoryById.get(selSubCategoryId)?.name ?? "" : `All — ${category.name}`;
  const itemRows = items
    .map((p) => {
      const m = data.itemMappingOf(vendor.id, p.id);
      const state = m ? m.state : "none";
      return `<tr>
        <td class="ep-cell ep-mono fs-11-5px">${esc(p.code)}</td>
        <td class="ep-cell">${esc(p.name)}${p.min_mapping_rating != null ? `<div class="ep-sub">min rating ${p.min_mapping_rating}</div>` : ""}</td>
        <td class="ep-cell">${esc(p.sub_category || "—")}</td>
        <td class="ep-cell text-center">${statusButton(state, `data-item="${p.id}"`)}</td>
      </tr>`;
    })
    .join("");

  body.innerHTML = `
    <div class="ep-pane-pad">
      <div class="d-flex items-center justify-between gap-14px maxw-640px">
        <div><div class="ep-k">Whole-category mapping</div><div class="fw-600">${esc(vendor.legal_name)} → ${esc(category.name)}</div>
          <div class="hint">Approves ${esc(vendor.legal_name)} for every item in this category.</div></div>
        ${statusButton(categoryState, 'data-category="1"')}
      </div>
    </div>
    <div class="ep-pane-pad border-top-1px-solid-ink-18">
      <div class="ep-k mb-8px">Item mapping — "${esc(itemSectionLabel)}"</div>
      ${
        items.length
          ? `<table class="ep-table"><thead><tr><th class="ep-th">Code</th><th class="ep-th">Item</th><th class="ep-th">Sub-category</th><th class="ep-th text-center">Mapped</th></tr></thead><tbody>${itemRows}</tbody></table>`
          : '<div class="hint">No items here yet.</div>'
      }
    </div>
    <div class="d-flex gap-22px flex-wrap padding-10px-16px fs-11-5px text-ink-62 border-top-1px-solid-ink-18">
      <span>✓ mapped and approved</span><span>— not mapped (may be pending, suspended or rejected — click for details, or see Mapping requests)</span>
    </div>`;

  body.querySelector("[data-category]")?.addEventListener("click", () =>
    openMappingDialog({
      data,
      vendor,
      kind: "category",
      target: category,
      mapping: categoryMapping,
      onChanged: refresh,
    })
  );
  body.querySelectorAll("[data-item]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const product = data.productById.get(Number(btn.dataset.item));
      openMappingDialog({
        data,
        vendor,
        kind: "item",
        target: product,
        mapping: data.itemMappingOf(vendor.id, product.id),
        onChanged: refresh,
      });
    })
  );
}
