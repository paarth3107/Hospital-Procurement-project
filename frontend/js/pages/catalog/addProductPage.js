import { showResult } from "../../ui.js";
import { switchView } from "../../nav.js";
import { state } from "../../state.js";
import { esc, typeTag } from "../../kit.js";
import { openItemForm } from "./itemForm.js";
import { openAssetForm } from "./assetForm.js";
import { openServiceForm } from "./serviceForm.js";
import { loadCatalogData, takeEditingProductId } from "./catalogData.js";

// ---- Add Product (Catalog sidebar item 2 of 4, 2026-10-07 -- see TODO.md).
// Doubles as the edit screen, same as Vuexy's own Add Product page: Product
// List's Edit button sets an id in catalogData.js and switches here, which
// reads and clears it on load. Creating new shows a type switch
// (Item/Asset/Service) above a blank form; editing fixes the type. ----
const root = () => document.getElementById("catalog-add-root");
const resultEl = () => document.getElementById("catalog-add-result");

const FORM_BY_TYPE = { item: openItemForm, asset: openAssetForm, service: openServiceForm };
const TYPE_OPTS = [["item", "Item"], ["asset", "Asset"], ["service", "Service"]];

let categories = [];
let subCategories = [];
let editingProduct = null; // null while creating new
let addType = "item"; // which type's blank form to show when creating new

function render() {
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    <div class="d-flex items-baseline gap-14px flex-wrap">
      <span class="fs-18px fw-800">${editingProduct ? `Edit ${esc(editingProduct.name)}` : "Add a new catalog entry"}</span>
      ${editingProduct ? typeTag(editingProduct.procurement_type) : ""}
    </div>
    ${
      editingProduct
        ? ""
        : `<div class="ep-seg self-start">${TYPE_OPTS.map(([k, l]) => `<button data-add-type="${k}" class="${k === addType ? "on" : ""}">${l}</button>`).join("")}</div>`
    }
    <div id="catalog-add-form-host"></div>
  </div>`;
  root()
    .querySelectorAll("[data-add-type]")
    .forEach((b) =>
      b.addEventListener("click", () => {
        addType = b.dataset.addType;
        render();
      })
    );
  renderForm();
}

// The actual form, rendered imperatively into its own sub-host (the
// surrounding tab chrome above is declarative, the form itself isn't --
// same reasoning as the officer dashboard's donut chart div).
function renderForm() {
  const formHost = document.getElementById("catalog-add-form-host");
  if (!formHost) return;
  const onSaved = async (message) => {
    await loadCatalogData(true); // force a refresh -- Product List reads this cache next
    // Flash the success message on the destination screen rather than
    // showing it here then immediately switching away -- same pattern
    // vendorDashboardPage.js uses for a message that must survive a
    // switchView() into another page's own async load.
    state.flash = message;
    switchView("catalog-list");
  };
  const onCancel = () => switchView("catalog-list");
  const type = editingProduct ? editingProduct.procurement_type : addType;
  FORM_BY_TYPE[type](formHost, editingProduct, categories, subCategories, onSaved, onCancel);
}

export async function loadAddProduct() {
  try {
    const data = await loadCatalogData();
    categories = data.categories;
    subCategories = data.subCategories;
    const id = takeEditingProductId();
    editingProduct = id ? data.products.find((p) => p.id === id) || null : null;
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load catalog: " + err.message, false);
  }
}
