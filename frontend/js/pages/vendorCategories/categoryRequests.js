import { api } from "../../api.js";
import { tag, typeTag, esc, imgPlaceholder } from "../../kit.js";
import { categoryRequirements, requirementPills } from "./requirements.js";

// Category-level requests: the vendor asks to supply a whole category. A
// Category Manager approves each category separately from any items in it.
// A category with no request yet, or one that was Rejected, can be picked --
// Rejected isn't a dead end, it can be tried again (same as a rejected document).
// A real table now (2026-10-08, was a flex-wrapped cloud of checkbox pills):
// Name, Type and Min rating are columns like every other list in the app,
// searched and filtered by procurement type client-side since every
// category is already fetched up front for the page -- no new endpoint.
export function openCategories({ categories, mappingByCategory }) {
  return categories.filter((c) => {
    const m = mappingByCategory.get(c.id);
    return !m || m.state === "rejected";
  });
}

export function renderCategoryRequestTable(ctx, filters, selectedIds) {
  const open = openCategories(ctx);
  if (!open.length) return { countLabel: "0 categories", bodyHtml: `<tr><td class="ep-cell text-ink-55" colspan="4">Every category already has a request on file.</td></tr>` };

  const f = filters.search.trim().toLowerCase();
  const matches = open.filter((c) => (filters.typeFilter === "all" || c.procurement_type === filters.typeFilter) && c.name.toLowerCase().includes(f));
  const countLabel = f || filters.typeFilter !== "all" ? `${matches.length} of ${open.length} categories` : `${open.length} categories`;
  if (!matches.length) return { countLabel, bodyHtml: `<tr><td class="ep-cell text-ink-55" colspan="4">No category matches "${esc(filters.search)}".</td></tr>` };

  const bodyHtml = matches
    .map((c) => {
      const req = categoryRequirements(c, ctx.docsByKey);
      const disabled = req.missing.length > 0;
      const rejected = ctx.mappingByCategory.get(c.id)?.state === "rejected";
      return `<tr>
        <td class="ep-cell vc-col-check"><input type="checkbox" data-category-id="${c.id}" ${selectedIds.has(c.id) ? "checked" : ""} ${disabled ? "disabled" : ""}></td>
        <td class="ep-cell">
          <div class="vc-name-cell">
            ${imgPlaceholder("layers", "sm")}
            <div class="minw-0">
              <div class="d-flex items-center gap-8px flex-wrap">
                <span class="fw-600">${esc(c.name)}</span>
                ${rejected ? tag("Rejected before — can retry", "neg") : ""}
              </div>
              ${requirementPills(req)}
            </div>
          </div>
        </td>
        <td class="ep-cell text-center">${typeTag(c.procurement_type)}</td>
        <td class="ep-cell text-center">${c.min_mapping_rating != null ? `${c.min_mapping_rating}+` : '<span class="ep-sub">—</span>'}</td>
      </tr>`;
    })
    .join("");
  return { countLabel, bodyHtml };
}

export async function submitCategoryRequests(selectedIds) {
  return sendRequests([...selectedIds].map((id) => ({ category_id: id })));
}

export async function sendRequests(bodies) {
  let created = 0;
  const failed = [];
  for (const body of bodies) {
    try {
      await api("/vendor-portal/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      created++;
    } catch (err) {
      failed.push(err.message);
    }
  }
  return { created, failed };
}
