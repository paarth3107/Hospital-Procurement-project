import { api } from "../../api.js";
import { esc } from "../../kit.js";
import { requiredDocsHtml, wireRequiredDocs, readRequiredDocs } from "./requiredDocs.js";
import { showResult } from "../../ui.js";
import { modalChoose } from "../../modal.js";

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
        <div class="ep-k" style="margin:14px 0 8px">Documents required from a vendor to be mapped to this category</div>
        ${requiredDocsHtml(category?.required_documents || [])}
      </div>
      <div style="display:flex;gap:8px">
        <button type="submit" class="ep-b" data-v="p">${category ? "Save changes" : "Add category"}</button>
        <button type="button" class="ep-b cancel-btn">Cancel</button>
      </div>
      <div class="result form-result"></div>
    </form>`;

  const form = host.querySelector("form");
  form.querySelector(".cancel-btn").addEventListener("click", onCancel);
  wireRequiredDocs(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: form.elements.name.value.trim(),
      procurement_type: category ? category.procurement_type : form.elements.procurement_type.value,
      min_mapping_rating: form.elements.min_mapping_rating.value === "" ? null : Number(form.elements.min_mapping_rating.value),
      required_documents: readRequiredDocs(form),
    };
    try {
      // An item's own minimum rating overrides its category's. If some items in this
      // category set one, ask whether they should now follow the category instead.
      if (category && payload.min_mapping_rating !== category.min_mapping_rating) {
        const items = (await api(`/products?procurement_type=${category.procurement_type}`)).filter(
          (p) => p.category_id === category.id && p.min_mapping_rating != null && p.min_mapping_rating !== payload.min_mapping_rating
        );
        if (items.length) {
          const list = items.map((p) => `${p.name} (${p.min_mapping_rating})`).join(", ");
          const choice = await modalChoose(
            `${items.length} item(s) in this category set their own minimum rating, which overrides the category's: ${list}. Should they follow the category minimum${payload.min_mapping_rating == null ? " (none)" : ` (${payload.min_mapping_rating})`} instead?`,
            [
              { value: "follow", label: "Yes, make them follow the category" },
              { value: "keep", label: "No, keep their own minimums" },
            ],
            "Items with their own minimum"
          );
          if (choice === null) return;
          payload.apply_minimum_to_items = choice === "follow";
        }
      }
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
