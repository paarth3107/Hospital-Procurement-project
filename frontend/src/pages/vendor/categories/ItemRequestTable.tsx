import { Fragment } from "react";
import { ImgPlaceholder } from "../../../components/ImgPlaceholder";
import { Icon } from "../../../lib/icons";
import { Tag, TypeTag } from "../../../components/Tag";
import { itemRequirements, RequirementPills } from "./requirementHelpers";
import type { CatalogProduct } from "../../../lib/types";
import type { RequestCtx, RequestFilters } from "./types";

// Ported 1:1 from frontend/js/pages/vendorCategories/itemRequests.js --
// item-level requests: for a vendor who supplies only some items of a
// category (or whose category request wasn't approved). Listed for items
// with no request yet, a Rejected one (can be tried again), and not
// already covered by an approved category. Grouped by category (collapsed
// by default -- there can be 100s of items) with Name/SKU/Type/Min rating
// as actual columns.
interface Candidate {
  p: CatalogProduct;
  covered: boolean;
  rejected: boolean;
}

function candidateItems(ctx: Pick<RequestCtx, "products" | "mappingByCategory" | "mappingByProduct">): Candidate[] {
  // An item under an approved category is hidden only when the category truly
  // covers it. If the item has its own requirements (documents or a minimum
  // rating) the vendor isn't eligible yet, so it stays requestable.
  const covered = (p: CatalogProduct) => ctx.mappingByCategory.get(p.category_id)?.state === "approved";
  const fullyCovered = (p: CatalogProduct) => covered(p) && !(p.required_documents || []).length && p.min_mapping_rating == null;
  const rejected = (p: CatalogProduct) => ctx.mappingByProduct.get(p.id)?.state === "rejected";
  return ctx.products.filter((p) => (!ctx.mappingByProduct.has(p.id) || rejected(p)) && !fullyCovered(p)).map((p) => ({ p, covered: covered(p), rejected: rejected(p) }));
}

function filteredCandidates(ctx: RequestCtx, filters: RequestFilters): Candidate[] {
  const candidates = candidateItems(ctx);
  const f = filters.search.trim().toLowerCase();
  const inType = (c: Candidate) => filters.typeFilter === "all" || c.p.procurement_type === filters.typeFilter;
  const matchesSearch = (c: Candidate) => !f || c.p.name.toLowerCase().includes(f) || c.p.category.toLowerCase().includes(f) || c.p.code.toLowerCase().includes(f);
  return candidates.filter((c) => inType(c) && matchesSearch(c));
}

export function itemCountLabel(ctx: RequestCtx, filters: RequestFilters): string {
  const candidates = candidateItems(ctx);
  if (!candidates.length) return "0 items";
  const matches = filteredCandidates(ctx, filters);
  const f = filters.search.trim();
  return f || filters.typeFilter !== "all" ? `${matches.length} of ${candidates.length} items` : `${candidates.length} items`;
}

export function ItemRequestTable({
  ctx,
  filters,
  selectedIds,
  expandedGroups,
  onToggle,
  onToggleGroup,
  onUpload,
}: {
  ctx: RequestCtx;
  filters: RequestFilters;
  selectedIds: Set<number>;
  expandedGroups: Set<number>;
  onToggle: (id: number) => void;
  onToggleGroup: (categoryId: number) => void;
  onUpload: (entry: string, isOther: boolean, customLabel: string) => void;
}) {
  const candidates = candidateItems(ctx);
  if (!candidates.length) {
    return (
      <tr>
        <td className="ep-cell text-ink-55" colSpan={5}>
          Nothing left to request here.
        </td>
      </tr>
    );
  }

  const matches = filteredCandidates(ctx, filters);
  if (!matches.length) {
    return (
      <tr>
        <td className="ep-cell text-ink-55" colSpan={5}>
          No item matches "{filters.search}".
        </td>
      </tr>
    );
  }

  const byCategory = new Map<number, { name: string; rows: Candidate[] }>();
  for (const c of matches) {
    if (!byCategory.has(c.p.category_id)) byCategory.set(c.p.category_id, { name: c.p.category, rows: [] });
    byCategory.get(c.p.category_id)!.rows.push(c);
  }
  const autoExpand = !!filters.search.trim(); // typing a search opens every matching group so results aren't hidden

  return (
    <>
      {[...byCategory.entries()].map(([categoryId, group]) => {
        const collapsed = !autoExpand && !expandedGroups.has(categoryId);
        return (
          <Fragment key={categoryId}>
            <tr className={`vc-group-row ${collapsed ? "" : "expanded"}`} onClick={() => onToggleGroup(categoryId)}>
              <td className="ep-cell" colSpan={5}>
                <div className="d-flex items-center justify-between">
                  <span className="d-flex items-center gap-8px">
                    <Icon name="chevron-right" size={13} className="vc-chev" /> {group.name}
                  </span>
                  <span className="ep-sub">
                    {group.rows.length} item{group.rows.length === 1 ? "" : "s"}
                  </span>
                </div>
              </td>
            </tr>
            {!collapsed &&
              group.rows.map(({ p, covered, rejected }) => {
                const req = itemRequirements(p, ctx.categoryById.get(p.category_id), ctx.docsByKey);
                const disabled = req.missing.length > 0;
                return (
                  <tr className="vc-item-row" key={p.id}>
                    <td className="ep-cell vc-col-check">
                      <input type="checkbox" checked={selectedIds.has(p.id)} disabled={disabled} onChange={() => onToggle(p.id)} />
                    </td>
                    <td className="ep-cell">
                      <div className="vc-name-cell">
                        <ImgPlaceholder iconName="package" size="sm" />
                        <div className="minw-0">
                          <div className="d-flex items-center gap-8px flex-wrap">
                            <span className="fw-600">{p.name}</span>
                            {rejected && <Tag text="Rejected before — can retry" tone="neg" />}
                          </div>
                          {covered && (
                            <div className="ep-sub mt-3px">
                              Category approved, but this item has its own requirements{p.min_mapping_rating != null ? ` (minimum rating ${p.min_mapping_rating})` : ""}.
                            </div>
                          )}
                          <RequirementPills req={req} onUpload={onUpload} />
                        </div>
                      </div>
                    </td>
                    <td className="ep-cell text-center">
                      <span className="ep-mono fw-600">{p.code}</span>
                    </td>
                    <td className="ep-cell text-center">
                      <TypeTag type={p.procurement_type} />
                    </td>
                    <td className="ep-cell text-center">{p.min_mapping_rating != null ? `${p.min_mapping_rating}+` : <span className="ep-sub">—</span>}</td>
                  </tr>
                );
              })}
          </Fragment>
        );
      })}
    </>
  );
}
