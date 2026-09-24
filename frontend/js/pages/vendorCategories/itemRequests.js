import { esc } from "../../kit.js";
import { sendRequests } from "./categoryRequests.js";

// Item-level requests: for a vendor who supplies only some items of a
// category (or whose category request wasn't approved). Listed only for items
// with no request yet and not already covered by an approved category.
export function renderItemRequestSection({ products, mappingByCategory, mappingByProduct }) {
  const candidates = products.filter((p) => !mappingByProduct.has(p.id) && mappingByCategory.get(p.category_id)?.state !== "approved");
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
          <div style="display:flex;flex-wrap:wrap;gap:8px 18px">${items.map((p) => `<label class="ep-check"><input type="checkbox" data-product-id="${p.id}"> ${esc(p.name)}</label>`).join("")}</div></div>`
      )
      .join("")}
    <button class="ep-b" data-v="p" id="request-items-btn">Request selected items</button>
  </div>`;
}

export async function submitItemRequests(container) {
  const ids = [...container.querySelectorAll("input[data-product-id]:checked")].map((el) => Number(el.dataset.productId));
  return sendRequests(ids.map((id) => ({ product_master_id: id })));
}
