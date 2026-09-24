import { api } from "../../api.js";
import { esc } from "../../kit.js";
import { categoryRequirements, requirementNote } from "./requirements.js";

// Category-level requests: the vendor asks to supply a whole category. A
// Category Manager approves each category separately from any items in it.
// Only categories with no request yet can be picked.
export function renderCategoryRequestSection({ categories, mappingByCategory, docsByKey }) {
  const open = categories.filter((c) => !mappingByCategory.has(c.id));
  return `<div>
    <div class="ep-k" style="margin-bottom:8px">Categories</div>
    ${
      open.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:10px 22px">${open
            .map((c) => {
              const req = categoryRequirements(c, docsByKey);
              return `<div><label class="ep-check"><input type="checkbox" data-category-id="${c.id}" ${req.missing.length ? "disabled" : ""}> ${esc(c.name)} <span class="ep-sub">${esc(c.procurement_type)}</span></label>${requirementNote(req)}</div>`;
            })
            .join("")}</div>
          <div style="margin-top:12px"><button class="ep-b" data-v="p" id="request-categories-btn">Request selected categories</button></div>`
        : '<div class="hint">Every category already has a request on file.</div>'
    }
  </div>`;
}

export async function submitCategoryRequests(container) {
  const ids = [...container.querySelectorAll("input[data-category-id]:checked")].map((el) => Number(el.dataset.categoryId));
  return sendRequests(ids.map((id) => ({ category_id: id })));
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
