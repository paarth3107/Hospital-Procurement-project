import { api } from "../../api.js";
import { esc } from "../../kit.js";
import { showResult } from "../../ui.js";

// Sub-categories are managed entries (not free text), same reasoning as
// categories (2026-10-01) -- so the vendor-mapping matrix's drill-down has a
// stable, typo-proof set of values to cascade through. Deliberately no
// rating/required-documents override here: only the category and item levels
// carry those gates today.
export function openSubCategoryForm(host, subCategory, categories, onSaved, onCancel) {
  host.hidden = false;
  host.innerHTML = `
    <form class="catalog-form ep-form" style="gap:16px">
      <div style="font-size:18px;font-weight:800">${subCategory ? "Edit" : "New"} sub-category</div>
      <div class="ep-pane ep-pane-pad">
        <div class="ep-form-grid" style="grid-template-columns:1fr 1fr">
          <div class="ep-field"><div class="ep-k">Category</div>
            <select class="input" name="category_id" ${subCategory ? "disabled" : ""}>
              ${categories.map((c) => `<option value="${c.id}" ${subCategory?.category_id === c.id ? "selected" : ""}>${esc(c.name)} (${esc(c.procurement_type)})</option>`).join("")}
            </select></div>
          <div class="ep-field"><div class="ep-k">Name</div><input class="input" name="name" required value="${esc(subCategory?.name ?? "")}"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button type="submit" class="ep-b" data-v="p">${subCategory ? "Save changes" : "Add sub-category"}</button>
        <button type="button" class="ep-b cancel-btn">Cancel</button>
      </div>
      <div class="result form-result"></div>
    </form>`;

  const form = host.querySelector("form");
  form.querySelector(".cancel-btn").addEventListener("click", onCancel);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: form.elements.name.value.trim(),
      category_id: subCategory ? subCategory.category_id : Number(form.elements.category_id.value),
    };
    try {
      await api(subCategory ? `/subcategories/${subCategory.id}` : "/subcategories", {
        method: subCategory ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved(`${subCategory ? "Updated" : "Added"} sub-category ${payload.name}.`);
    } catch (err) {
      showResult(form.querySelector(".form-result"), "Could not save: " + err.message, false);
    }
  });
}
