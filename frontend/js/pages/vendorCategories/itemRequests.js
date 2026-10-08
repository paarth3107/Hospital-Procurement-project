import { esc, tag, typeTag, imgPlaceholder } from "../../kit.js";
import { sendRequests } from "./categoryRequests.js";
import { itemRequirements, requirementPills } from "./requirements.js";

// Item-level requests: for a vendor who supplies only some items of a
// category (or whose category request wasn't approved). Listed for items with
// no request yet, a Rejected one (can be tried again), and not already
// covered by an approved category. A real table now (2026-10-08, was a
// flex-wrapped cloud of checkbox pills), grouped by category (collapsed by
// default -- there can be 100s of items) with Name/SKU/Type/Min rating as
// actual columns, searched and filtered by procurement type client-side.
function candidateItems({ products, mappingByCategory, mappingByProduct }) {
  // An item under an approved category is hidden only when the category truly
  // covers it. If the item has its own requirements (documents or a minimum
  // rating) the vendor isn't eligible yet, so it stays requestable.
  const covered = (p) => mappingByCategory.get(p.category_id)?.state === "approved";
  const fullyCovered = (p) => covered(p) && !(p.required_documents || []).length && p.min_mapping_rating == null;
  const rejected = (p) => mappingByProduct.get(p.id)?.state === "rejected";
  return products
    .filter((p) => (!mappingByProduct.has(p.id) || rejected(p)) && !fullyCovered(p))
    .map((p) => ({ p, covered: covered(p), rejected: rejected(p) }));
}

export function renderItemRequestTable(ctx, filters, selectedIds, expandedGroups) {
  const candidates = candidateItems(ctx);
  if (!candidates.length) return { countLabel: "0 items", bodyHtml: `<tr><td class="ep-cell text-ink-55" colspan="5">Nothing left to request here.</td></tr>` };

  const f = filters.search.trim().toLowerCase();
  const inType = ({ p }) => filters.typeFilter === "all" || p.procurement_type === filters.typeFilter;
  const matchesSearch = ({ p }) => !f || p.name.toLowerCase().includes(f) || p.category.toLowerCase().includes(f) || p.code.toLowerCase().includes(f);
  const matches = candidates.filter((c) => inType(c) && matchesSearch(c));
  const countLabel = f || filters.typeFilter !== "all" ? `${matches.length} of ${candidates.length} items` : `${candidates.length} items`;
  if (!matches.length) return { countLabel, bodyHtml: `<tr><td class="ep-cell text-ink-55" colspan="5">No item matches "${esc(filters.search)}".</td></tr>` };

  const byCategory = new Map();
  for (const c of matches) {
    if (!byCategory.has(c.p.category_id)) byCategory.set(c.p.category_id, { name: c.p.category, rows: [] });
    byCategory.get(c.p.category_id).rows.push(c);
  }
  const autoExpand = !!f; // typing a search opens every matching group so results aren't hidden
  const bodyHtml = [...byCategory.entries()]
    .map(([categoryId, group]) => {
      const collapsed = !autoExpand && !expandedGroups.has(categoryId);
      const rows = group.rows
        .map(({ p, covered, rejected }) => {
          const req = itemRequirements(p, ctx.categoryById.get(p.category_id), ctx.docsByKey);
          const disabled = req.missing.length > 0;
          const note = covered
            ? `<div class="ep-sub mt-3px">Category approved, but this item has its own requirements${p.min_mapping_rating != null ? ` (minimum rating ${p.min_mapping_rating})` : ""}.</div>`
            : "";
          return `<tr class="vc-item-row" data-group="${categoryId}" ${collapsed ? "hidden" : ""}>
            <td class="ep-cell vc-col-check"><input type="checkbox" data-product-id="${p.id}" ${selectedIds.has(p.id) ? "checked" : ""} ${disabled ? "disabled" : ""}></td>
            <td class="ep-cell">
              <div class="vc-name-cell">
                ${imgPlaceholder("package", "sm")}
                <div class="minw-0">
                  <div class="d-flex items-center gap-8px flex-wrap">
                    <span class="fw-600">${esc(p.name)}</span>
                    ${rejected ? tag("Rejected before — can retry", "neg") : ""}
                  </div>
                  ${note}
                  ${requirementPills(req)}
                </div>
              </div>
            </td>
            <td class="ep-cell text-center"><span class="ep-mono fw-600">${esc(p.code)}</span></td>
            <td class="ep-cell text-center">${typeTag(p.procurement_type)}</td>
            <td class="ep-cell text-center">${p.min_mapping_rating != null ? `${p.min_mapping_rating}+` : '<span class="ep-sub">—</span>'}</td>
          </tr>`;
        })
        .join("");
      return `<tr class="vc-group-row ${collapsed ? "" : "expanded"}" data-group-toggle="${categoryId}">
        <td class="ep-cell" colspan="5">
          <div class="d-flex items-center justify-between">
            <span class="d-flex items-center gap-8px"><svg class="vc-chev" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>${esc(group.name)}</span>
            <span class="ep-sub">${group.rows.length} item${group.rows.length === 1 ? "" : "s"}</span>
          </div>
        </td>
      </tr>${rows}`;
    })
    .join("");
  return { countLabel, bodyHtml };
}

export async function submitItemRequests(selectedIds) {
  return sendRequests([...selectedIds].map((id) => ({ product_master_id: id })));
}
