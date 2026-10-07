import { showResult } from "../../ui.js";
import { esc, tag, typeTag, imgPlaceholder } from "../../kit.js";
import { openCategoryForm } from "./categoryForm.js";
import { docLabel } from "../../constants.js";
import { loadCatalogData } from "./catalogData.js";

// ---- Category List (Catalog sidebar item 3 of 4, 2026-10-07 -- see
// TODO.md). A card per category (Vuexy's own ecommerce category grid)
// instead of a table row -- the image placeholder is where a real category
// photo lands later. ----
const root = () => document.getElementById("catalog-categories-root");
const host = () => document.getElementById("catalog-categories-form-host");
const resultEl = () => document.getElementById("catalog-categories-result");

let categories = [];
let products = [];

function closeForm() {
  host().hidden = true;
  host().innerHTML = "";
}

async function afterSave(message) {
  closeForm();
  await loadCategories(true);
  showResult(resultEl(), message, true);
}

function showForm(open) {
  open();
  host().scrollIntoView({ behavior: "smooth", block: "start" });
}

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
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    <div class="d-flex items-center gap-14px flex-wrap">
      <div class="hint flex-1">restricted categories need a minimum vendor rating to map</div>
      <button class="ep-b" data-new="category">+ New category</button>
    </div>
    ${categoryCards()}
  </div>`;
  wire();
}

function wire() {
  const r = root();
  r.querySelector("[data-new]")?.addEventListener("click", () => {
    showForm(() => openCategoryForm(host(), null, afterSave, closeForm));
  });
  r.querySelectorAll("[data-edit-category]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = categories.find((x) => x.id === Number(b.dataset.editCategory));
      showForm(() => openCategoryForm(host(), c, afterSave, closeForm));
    })
  );
}

export async function loadCategories(force = false) {
  try {
    const data = await loadCatalogData(force);
    categories = data.categories;
    products = data.products;
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load categories: " + err.message, false);
  }
}
