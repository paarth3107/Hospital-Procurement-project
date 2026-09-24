import { esc } from "../../kit.js";
import { sendRequests } from "./categoryRequests.js";
import { itemRequirements, requirementNote } from "./requirements.js";

// Item-level requests: for a vendor who supplies only some items of a
// category (or whose category request wasn't approved). Listed only for items
// with no request yet and not already covered by an approved category.
export function renderItemRequestSection({ products, categories, mappingByCategory, mappingByProduct, docsByKey }) {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  // An item under an approved category is hidden only when the category truly
  // covers it. If the item has its own requirements (documents or a minimum
  // rating) the vendor isn't eligible yet, so it stays requestable.
  const covered = (p) => mappingByCategory.get(p.category_id)?.state === "approved";
  const fullyCovered = (p) => covered(p) && !(p.required_documents || []).length && p.min_mapping_rating == null;
  const candidates = products.filter((p) => !mappingByProduct.has(p.id) && !fullyCovered(p));
  if (candidates.length === 0) return "";

  const byCategory = new Map();
  for (const p of candidates) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  }
  return `<div>
    <div class="ep-k" style="margin-bottom:4px">Individual items</div>
    <div class="hint" style="margin-bottom:10px">Only need to supply specific items rather than a whole category? Request them here.</div>
    ${[...byCategory.entries()]
      .map(
        ([category, items]) => `<div style="margin-bottom:12px"><div class="ep-sub" style="font-weight:600;margin-bottom:4px">${esc(category)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px 18px">${items
            .map((p) => {
              const req = itemRequirements(p, categoryById.get(p.category_id), docsByKey);
              const note = covered(p)
                ? `<div class="ep-sub" style="margin-left:22px">Your category is approved, but this item has its own requirements${p.min_mapping_rating != null ? ` (minimum rating ${p.min_mapping_rating})` : ""}.</div>`
                : "";
              return `<div><label class="ep-check"><input type="checkbox" data-product-id="${p.id}" ${req.missing.length ? "disabled" : ""}> ${esc(p.name)}</label>${note}${requirementNote(req)}</div>`;
            })
            .join("")}</div></div>`
      )
      .join("")}
    <button class="ep-b" data-v="p" id="request-items-btn">Request selected items</button>
  </div>`;
}

export async function submitItemRequests(container) {
  const ids = [...container.querySelectorAll("input[data-product-id]:checked")].map((el) => Number(el.dataset.productId));
  return sendRequests(ids.map((id) => ({ product_master_id: id })));
}
