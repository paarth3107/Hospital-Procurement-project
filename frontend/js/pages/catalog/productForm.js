import { api } from "../../api.js";
import { esc, typeTag } from "../../kit.js";
import { showResult } from "../../ui.js";
import { modalPrompt, modalAlert } from "../../modal.js";
import { fieldHtml, readFields, wireConditionalFields } from "./formKit.js";
import { coreDetailsHtml, wireCoreDetails, readCoreDetails } from "./coreDetails.js";

// The one form skeleton shared by the Item, Asset and Service forms. Each of
// those (itemForm.js / assetForm.js / serviceForm.js) only describes what is
// different: its type and its type-specific fields (spec 4.2.1 / 4.2.2).
//
// options: { host, procurementType, typeLabel, typeFields, product (or null to create), categories, subCategories, onSaved, onCancel }
export function renderProductForm({ host, procurementType, typeLabel, typeFields, product, categories, subCategories, onSaved, onCancel }) {
  const attrs = product?.type_specific_attrs || {};
  const typeCategories = categories.filter((c) => c.procurement_type === procurementType);
  const subCategoryOptionsHtml = (categoryId) =>
    `<option value="">— none —</option>${subCategories
      .filter((s) => s.category_id === categoryId)
      .map((s) => `<option value="${s.id}" ${product?.sub_category_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`)
      .join("")}`;

  host.hidden = false;
  const group = (title, body) => `<div class="ep-pane"><div class="ep-pane-head"><span>${title}</span></div><div class="padding-6px-16px-14px">${body}</div></div>`;
  host.innerHTML = `
    <form class="catalog-form ep-form gap-16px">
      <div class="d-flex items-baseline gap-12px"><span class="fs-18px fw-800">${product ? "Edit" : "New"} ${typeLabel.toLowerCase()}</span>${typeTag(procurementType)}</div>
      <div class="ep-pane ep-pane-pad">
        <div class="ep-form-grid grid-cols-1fr-1fr-1fr">
          <div class="ep-field"><div class="ep-k">Code / SKU</div><input class="input" name="code" required value="${esc(product?.code ?? "")}"></div>
          <div class="ep-field col-span-2"><div class="ep-k">Name</div><input class="input" name="name" required value="${esc(product?.name ?? "")}"></div>
          <div class="ep-field col-span-3"><div class="ep-k">Description / specification</div><input class="input" name="description" value="${esc(product?.description ?? "")}"></div>
          <div class="ep-field col-span-2"><div class="ep-k">Category</div>
            <select class="input" name="category_id" required>
              <option value="">— select a category —</option>
              ${typeCategories.map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select></div>
          <div class="ep-field"><div class="ep-k">Sub-category (optional)</div>
            <div class="d-flex gap-6px">
              <select class="input flex-1" name="sub_category_id" id="sub-category-select">${subCategoryOptionsHtml(product?.category_id ?? null)}</select>
              <button type="button" class="ep-b" id="new-subcategory-btn">+ New</button>
            </div></div>
        </div>
      </div>
      ${group(`Core Details — tick the ones that apply to this ${typeLabel.toLowerCase()}`, `<div class="core-details">${coreDetailsHtml(product)}</div>`)}
      ${group(`${typeLabel} Details`, `<div class="type-details d-flex flex-col gap-12px pt-10px">${typeFields.map((f) => fieldHtml(f, attrs[f.name])).join("")}</div>`)}
      <div class="d-flex gap-8px">
        <button type="submit" class="ep-b" data-v="p">${product ? "Save changes" : "Add to catalog"}</button>
        <button type="button" class="ep-b cancel-btn">Cancel</button>
      </div>
      <div class="result form-result"></div>
    </form>`;

  const form = host.querySelector("form");
  wireCoreDetails(form.querySelector(".core-details"));
  wireConditionalFields(form.querySelector(".type-details"));
  form.querySelector(".cancel-btn").addEventListener("click", onCancel);

  const subCategorySelect = form.querySelector("#sub-category-select");
  form.elements.category_id.addEventListener("change", () => {
    subCategorySelect.innerHTML = subCategoryOptionsHtml(Number(form.elements.category_id.value) || null);
  });
  form.querySelector("#new-subcategory-btn").addEventListener("click", async () => {
    const categoryId = Number(form.elements.category_id.value) || null;
    if (!categoryId) return modalAlert("Pick a category first.");
    const name = await modalPrompt("New sub-category name");
    if (!name) return;
    try {
      const created = await api("/subcategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category_id: categoryId }),
      });
      subCategories.push(created);
      subCategorySelect.innerHTML = subCategoryOptionsHtml(categoryId);
      subCategorySelect.value = String(created.id);
    } catch (err) {
      showResult(form.querySelector(".form-result"), "Could not add sub-category: " + err.message, false);
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      code: form.elements.code.value.trim(),
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim() || null,
      procurement_type: procurementType,
      category_id: Number(form.elements.category_id.value),
      sub_category_id: form.elements.sub_category_id.value ? Number(form.elements.sub_category_id.value) : null,
      ...readCoreDetails(form.querySelector(".core-details")),
      type_specific_attrs: readFields(form.querySelector(".type-details"), typeFields),
    };
    const resultEl = form.querySelector(".form-result");
    try {
      await api(product ? `/products/${product.id}` : "/products", {
        method: product ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved(`${product ? "Updated" : "Added"} ${payload.name}.`);
    } catch (err) {
      showResult(resultEl, "Could not save: " + err.message, false);
    }
  });
}
