import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { switchView } from "../../nav.js";
import { state } from "../../state.js";
import { esc, tag, typeTag, th, emptyRow, pageSlice, paginationBar, wirePagination, imgPlaceholder } from "../../kit.js";
import { attrBits, priceBand } from "./attrSummary.js";
import { loadCatalogData, setEditingProductId } from "./catalogData.js";

// ---- Product List (Catalog sidebar item 1 of 4, 2026-10-07 -- see TODO.md
// for why this is 4 separate sidebar items and not 4 in-page tabs). Laid out
// like Vuexy's own eCommerce product list: one combined Product cell (image
// placeholder + name + code), Category, Type, attributes, price band,
// vendor count and a Status column. ----
const root = () => document.getElementById("catalog-list-root");
const resultEl = () => document.getElementById("catalog-list-result");

let products = [];
let mappings = [];
let typeFilter = "all";
let productPage = 0;
const expandedAttrs = new Set();
const ATTR_PREVIEW = 2;

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

function render() {
  const typeSeg = [["all", "All types"], ["item", "Item"], ["asset", "Asset"], ["service", "Service"]];
  const count = products.filter((p) => typeFilter === "all" || p.procurement_type === typeFilter).length;
  const { rows: productRowsHtml, totalPages: productTotalPages, page: productPageClamped } = productRows();
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    <div class="d-flex items-center gap-14px flex-wrap">
      <div class="ep-seg">${typeSeg.map(([k, l]) => `<button data-type="${k}" class="${k === typeFilter ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="hint flex-1">${count} entries · procurement type drives the line-item form and the mandatory attachment checklist</div>
      <button class="ep-b" data-v="p" data-goto-add>+ Add Product</button>
    </div>
    <div class="ep-pane">
      <table class="ep-table">${th("Product", "Category", "Type", "Type-specific attributes", "Price band", "Vendors", "Status", "")}<tbody>${productRowsHtml}</tbody></table>
      ${paginationBar(productPageClamped, productTotalPages, "catalog-list-prev", "catalog-list-next")}
    </div>
  </div>`;
  wire();
}

function wire() {
  const r = root();
  wirePagination(r, "catalog-list-prev", "catalog-list-next", productPage, (p) => {
    productPage = p;
    render();
  });
  r.querySelectorAll("[data-attrs]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = Number(b.dataset.attrs);
      if (expandedAttrs.has(id)) expandedAttrs.delete(id);
      else expandedAttrs.add(id);
      render();
    })
  );
  r.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => ((typeFilter = b.dataset.type), (productPage = 0), render())));
  r.querySelector("[data-goto-add]")?.addEventListener("click", () => {
    setEditingProductId(null);
    switchView("catalog-add");
  });
  r.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      setEditingProductId(Number(b.dataset.edit));
      switchView("catalog-add");
    })
  );
  r.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api(`/products/${b.dataset.toggle}/${b.dataset.action}`, { method: "POST" });
        await loadList(true);
      } catch (err) {
        showResult(resultEl(), `Could not ${b.dataset.action} catalog entry: ` + err.message, false);
      }
    })
  );
}

export async function loadList(force = false) {
  try {
    const data = await loadCatalogData(force);
    products = data.products;
    mappings = data.mappings;
    render();
    if (state.flash) {
      showResult(resultEl(), state.flash, true);
      state.flash = null;
    } else {
      resultEl().textContent = "";
    }
  } catch (err) {
    showResult(resultEl(), "Could not load catalog: " + err.message, false);
  }
}
