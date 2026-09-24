import { esc } from "../../kit.js";
import { itemRequirements, requirementNote } from "./requirements.js";

// Items under an approved category that carry their own required documents.
// The vendor is not eligible to bid on such an item until every one of those
// documents is uploaded AND Verified by staff, so this block is always shown
// (not hidden in the request panel) and says what is still outstanding.
export function renderCoveredItemsNotice({ products, categories, mappingByCategory, mappingByProduct, docsByKey }) {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const rows = products
    .filter((p) => mappingByCategory.get(p.category_id)?.state === "approved" && !mappingByProduct.has(p.id))
    .map((p) => ({ p, req: itemRequirements(p, categoryById.get(p.category_id), docsByKey) }))
    .filter(({ p, req }) => (p.required_documents || []).length && req.items.length)
    .map(({ p, req }) => {
      const verified = req.items.every((i) => docsByKey.get(i.key)?.status === "verified");
      return `<div style="margin-top:8px"><span style="font-weight:600">${esc(p.name)}</span>
        <span class="ep-sub">— ${verified ? "documents verified, eligible" : req.missing.length ? "documents needed" : "awaiting document verification"}</span>${requirementNote(req)}</div>`;
    });
  if (!rows.length) return "";
  return `<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(32,30,29,.25)">
    <div class="ep-k">Item documents required</div>
    <div class="hint" style="margin-top:4px">Your category is approved, but these items have their own required documents. You can bid on an item only once each document is uploaded and verified.</div>
    ${rows.join("")}
  </div>`;
}
