import { api } from "../../api.js";
import { esc } from "../../kit.js";
import { showResult } from "../../ui.js";

// Categories are managed entries (not free text), so items and vendor
// mappings all point at the same category. A category can require a minimum
// vendor rating before a mapping to it is approved (restricted/critical).
export function openCategoryForm(host, category, onSaved, onCancel) {
  host.hidden = false;
  host.innerHTML = `
    <form class="catalog-form ep-form" style="gap:16px">
      <div style="font-size:18px;font-weight:800">${category ? "Edit" : "New"} category</div>
      <div class="ep-pane ep-pane-pad">
        <div class="ep-form-grid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="ep-field"><div class="ep-k">Name</div><input class="input" name="name" required value="${esc(category?.name ?? "")}"></div>
          <div class="ep-field"><div class="ep-k">Procurement type</div>
            <select class="input" name="procurement_type" ${category ? "disabled" : ""}>
              ${["item", "asset", "service"].map((t) => `<option value="${t}" ${category?.procurement_type === t ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}
            </select></div>
          <div class="ep-field"><div class="ep-k">Min vendor rating to map (optional)</div>
            <input class="input" name="min_mapping_rating" type="number" step="any" min="0" max="100" value="${category?.min_mapping_rating ?? ""}"></div>
        </div>
        <p class="hint" style="margin-top:10px">Set a minimum only for restricted or critical categories (implants, high-value equipment, critical AMC).</p>
      </div>
      <div style="display:flex;gap:8px">
        <button type="submit" class="ep-b" data-v="p">${category ? "Save changes" : "Add category"}</button>
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
      procurement_type: category ? category.procurement_type : form.elements.procurement_type.value,
      min_mapping_rating: form.elements.min_mapping_rating.value === "" ? null : Number(form.elements.min_mapping_rating.value),
    };
    try {
      await api(category ? `/categories/${category.id}` : "/categories", {
        method: category ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved(`${category ? "Updated" : "Added"} category ${payload.name}.`);
    } catch (err) {
      showResult(form.querySelector(".form-result"), "Could not save: " + err.message, false);
    }
  });
}
