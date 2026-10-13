import { ImgPlaceholder } from "../../../components/ImgPlaceholder";
import { Tag, TypeTag } from "../../../components/Tag";
import { categoryRequirements, RequirementPills } from "./requirementHelpers";
import type { RequestCtx, RequestFilters } from "./types";

// Ported 1:1 from frontend/js/pages/vendorCategories/categoryRequests.js --
// category-level requests: the vendor asks to supply a whole category. A
// Category Manager approves each category separately from any items in it.
// A category with no request yet, or one that was Rejected, can be picked
// -- Rejected isn't a dead end, it can be tried again (same as a rejected
// document).
export function openCategories({ categories, mappingByCategory }: Pick<RequestCtx, "categories" | "mappingByCategory">) {
  return categories.filter((c) => {
    const m = mappingByCategory.get(c.id);
    return !m || m.state === "rejected";
  });
}

export function CategoryRequestTable({
  ctx,
  filters,
  selectedIds,
  onToggle,
  onUpload,
}: {
  ctx: RequestCtx;
  filters: RequestFilters;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onUpload: (entry: string, isOther: boolean, customLabel: string) => void;
}) {
  const open = openCategories(ctx);
  if (!open.length) {
    return (
      <tr>
        <td className="ep-cell text-ink-55" colSpan={4}>
          Every category already has a request on file.
        </td>
      </tr>
    );
  }

  const f = filters.search.trim().toLowerCase();
  const matches = open.filter((c) => (filters.typeFilter === "all" || c.procurement_type === filters.typeFilter) && c.name.toLowerCase().includes(f));
  if (!matches.length) {
    return (
      <tr>
        <td className="ep-cell text-ink-55" colSpan={4}>
          No category matches "{filters.search}".
        </td>
      </tr>
    );
  }

  return (
    <>
      {matches.map((c) => {
        const req = categoryRequirements(c, ctx.docsByKey);
        const disabled = req.missing.length > 0;
        const rejected = ctx.mappingByCategory.get(c.id)?.state === "rejected";
        return (
          <tr key={c.id}>
            <td className="ep-cell vc-col-check">
              <input type="checkbox" checked={selectedIds.has(c.id)} disabled={disabled} onChange={() => onToggle(c.id)} />
            </td>
            <td className="ep-cell">
              <div className="vc-name-cell">
                <ImgPlaceholder iconName="layers" size="sm" />
                <div className="minw-0">
                  <div className="d-flex items-center gap-8px flex-wrap">
                    <span className="fw-600">{c.name}</span>
                    {rejected && <Tag text="Rejected before — can retry" tone="neg" />}
                  </div>
                  <RequirementPills req={req} onUpload={onUpload} />
                </div>
              </div>
            </td>
            <td className="ep-cell text-center">
              <TypeTag type={c.procurement_type} />
            </td>
            <td className="ep-cell text-center">{c.min_mapping_rating != null ? `${c.min_mapping_rating}+` : <span className="ep-sub">—</span>}</td>
          </tr>
        );
      })}
    </>
  );
}

// countLabel is computed the same way in both tables -- exported so the
// shell (RequestPanel.tsx) can show it without duplicating this logic.
export function categoryCountLabel(ctx: RequestCtx, filters: RequestFilters): string {
  const open = openCategories(ctx);
  if (!open.length) return "0 categories";
  const f = filters.search.trim().toLowerCase();
  const matches = open.filter((c) => (filters.typeFilter === "all" || c.procurement_type === filters.typeFilter) && c.name.toLowerCase().includes(f));
  return f || filters.typeFilter !== "all" ? `${matches.length} of ${open.length} categories` : `${open.length} categories`;
}
