import { showResult } from "../../ui.js";
import { esc, typeTag, th, emptyRow } from "../../kit.js";
import { openSubCategoryForm } from "./subCategoryForm.js";
import { loadCatalogData } from "./catalogData.js";

// ---- Sub-Category List (Catalog sidebar item 4 of 4, 2026-10-07 -- see
// TODO.md). This app's own concept, alongside Vuexy's Product List / Add
// Product / Category List -- used by the vendor-mapping drill-down. ----
const root = () => document.getElementById("catalog-subcategories-root");
const host = () => document.getElementById("catalog-subcategories-form-host");
const resultEl = () => document.getElementById("catalog-subcategories-result");

let categories = [];
let subCategories = [];

function closeForm() {
  host().hidden = true;
  host().innerHTML = "";
}

async function afterSave(message) {
  closeForm();
  await loadSubCategories(true);
  showResult(resultEl(), message, true);
}

function showForm(open) {
  open();
  host().scrollIntoView({ behavior: "smooth", block: "start" });
}

function render() {
  root().innerHTML = `<div class="ep-pane">
    <div class="ep-pane-head"><span>Sub-Categories</span><span class="d-flex items-center gap-10px"><span class="ep-k">used by the vendor-mapping drill-down</span><button class="ep-b" data-new="subcategory">+ New sub-category</button></span></div>
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
  </div>`;
  wire();
}

function wire() {
  const r = root();
  r.querySelector("[data-new]")?.addEventListener("click", () => {
    showForm(() => openSubCategoryForm(host(), null, categories, afterSave, closeForm));
  });
  r.querySelectorAll("[data-edit-subcategory]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = subCategories.find((x) => x.id === Number(b.dataset.editSubcategory));
      showForm(() => openSubCategoryForm(host(), s, categories, afterSave, closeForm));
    })
  );
}

export async function loadSubCategories(force = false) {
  try {
    const data = await loadCatalogData(force);
    categories = data.categories;
    subCategories = data.subCategories;
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load sub-categories: " + err.message, false);
  }
}
