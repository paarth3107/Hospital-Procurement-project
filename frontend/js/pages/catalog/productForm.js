import { api } from "../../api.js";
import { esc, typeTag } from "../../kit.js";
import { showResult } from "../../ui.js";
import { fieldHtml, readFields, wireConditionalFields } from "./formKit.js";
import { coreDetailsHtml, wireCoreDetails, readCoreDetails } from "./coreDetails.js";

// The one form skeleton shared by the Item, Asset and Service forms. Each of
// those (itemForm.js / assetForm.js / serviceForm.js) only describes what is
// different: its type and its type-specific fields (spec 4.2.1 / 4.2.2).
//
// options: { host, procurementType, typeLabel, typeFields, product (or null to create), categories, onSaved, onCancel }
export function renderProductForm({ host, procurementType, typeLabel, typeFields, product, categories, onSaved, onCancel }) {
  const attrs = product?.type_specific_attrs || {};
  const typeCategories = categories.filter((c) => c.procurement_type === procurementType);

  host.hidden = false;
  const group = (title, body) => `<div class="ep-pane"><div class="ep-pane-head"><span>${title}</span></div><div style="padding:6px 16px 14px">${body}</div></div>`;
  host.innerHTML = `
    <form class="catalog-form ep-form" style="gap:16px">
      <div style="display:flex;align-items:baseline;gap:12px"><span style="font-size:18px;font-weight:800">${product ? "Edit" : "New"} ${typeLabel.toLowerCase()}</span>${typeTag(procurementType)}</div>
      <div class="ep-pane ep-pane-pad">
        <div class="ep-form-grid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="ep-field"><div class="ep-k">Code / SKU</div><input class="input" name="code" required value="${esc(product?.code ?? "")}"></div>
          <div class="ep-field" style="grid-column:span 2"><div class="ep-k">Name</div><input class="input" name="name" required value="${esc(product?.name ?? "")}"></div>
          <div class="ep-field" style="grid-column:span 3"><div class="ep-k">Description / specification</div><input class="input" name="description" value="${esc(product?.description ?? "")}"></div>
          <div class="ep-field" style="grid-column:span 2"><div class="ep-k">Category</div>
            <select class="input" name="category_id" required>
              <option value="">— select a category —</option>
              ${typeCategories.map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
            </select></div>
          <div class="ep-field"><div class="ep-k">Sub-category (optional)</div><input class="input" name="sub_category" value="${esc(product?.sub_category ?? "")}"></div>
        </div>
      </div>
      ${group(`Core details — tick the ones that apply to this ${typeLabel.toLowerCase()}`, `<div class="core-details">${coreDetailsHtml(product)}</div>`)}
      ${group(`${typeLabel} details`, `<div class="type-details" style="display:flex;flex-direction:column;gap:12px;padding-top:10px">${typeFields.map((f) => fieldHtml(f, attrs[f.name])).join("")}</div>`)}
      <div style="display:flex;gap:8px">
        <button type="submit" class="ep-b" data-v="p">${product ? "Save changes" : "Add to catalog"}</button>
        <button type="button" class="ep-b cancel-btn">Cancel</button>
      </div>
      <div class="result form-result"></div>
    </form>`;

  const form = host.querySelector("form");
  wireCoreDetails(form.querySelector(".core-details"));
  wireConditionalFields(form.querySelector(".type-details"));
  form.querySelector(".cancel-btn").addEventListener("click", onCancel);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      code: form.elements.code.value.trim(),
      name: form.elements.name.value.trim(),
      description: form.elements.description.value.trim() || null,
      procurement_type: procurementType,
      category_id: Number(form.elements.category_id.value),
      sub_category: form.elements.sub_category.value.trim() || null,
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
