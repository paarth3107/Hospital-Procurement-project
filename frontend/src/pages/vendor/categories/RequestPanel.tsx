import { useState } from "react";
import { CategoryRequestTable, categoryCountLabel } from "./CategoryRequestTable";
import { ItemRequestTable, itemCountLabel } from "./ItemRequestTable";
import { submitCategoryRequests, submitItemRequests } from "./sendRequests";
import type { RequestCtx, RequestFilters, RequestTab } from "./types";

// Ported 1:1 from frontend/js/pages/vendorCategories/vendorCategoriesPage.js's
// renderRequestShell()/renderTbody() -- a real searchable table (2026-10-08,
// was a flex-wrapped cloud of checkbox pills): Items tab first since that's
// what most vendors want, with a shared search box + Item/Asset/Service
// type filter.
//
// Real bug, found 2026-10-24: this tab/table lists all three procurement
// types (items, assets AND services -- e.g. a Facility Services category
// full of Service-type rows), but the tab, name column, and search
// placeholder all said "Item"/"items", the exact same word the type filter
// uses for its narrower "Item only" option just to its right -- so "Item"
// simultaneously meant "everything here" and "one specific type," and the
// search placeholder said "codes" for a column actually labeled "SKU".
// Renamed the generic uses to "Name"/"entries" throughout and matched the
// placeholder's wording to the real column names; "Item" stays untouched as
// a type-filter value, where it correctly does mean the specific type.
const TYPE_FILTER_OPTS: [string, string][] = [
  ["all", "All types"],
  ["item", "Item"],
  ["asset", "Asset"],
  ["service", "Service"],
];

export function RequestPanel({
  ctx,
  onUpload,
  onSubmitted,
}: {
  ctx: RequestCtx;
  onUpload: (entry: string, isOther: boolean, customLabel: string) => void;
  onSubmitted: (message: string, ok: boolean) => void;
}) {
  const [tab, setTab] = useState<RequestTab>("items");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<number>>(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const filters: RequestFilters = { search, typeFilter };
  const selected = tab === "items" ? selectedProductIds : selectedCategoryIds;

  const toggleCategory = (id: number) =>
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleProduct = (id: number) =>
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleGroup = (categoryId: number) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });

  const changeTab = (t: RequestTab) => {
    setTab(t);
    setSearch("");
  };

  const submit = async () => {
    setSubmitting(true);
    const { created, failed } = await (tab === "items" ? submitItemRequests(selected) : submitCategoryRequests(selected));
    setSelectedCategoryIds(new Set());
    setSelectedProductIds(new Set());
    setSubmitting(false);
    onSubmitted(`${created} request(s) sent${failed.length ? `, ${failed.length} failed (${failed[0]})` : ""}.`, failed.length === 0);
  };

  const countLabel = tab === "items" ? itemCountLabel(ctx, filters) : categoryCountLabel(ctx, filters);

  return (
    <div>
      <div className="ep-seg mb-14px">
        <button type="button" className={tab === "items" ? "on" : ""} onClick={() => changeTab("items")}>
          Items, assets &amp; services
        </button>
        <button type="button" className={tab === "categories" ? "on" : ""} onClick={() => changeTab("categories")}>
          Categories
        </button>
      </div>
      <div className="d-flex items-center gap-14px flex-wrap mb-12px">
        <div className="flex-1 minw-220px">
          <input
            className="input"
            placeholder={tab === "items" ? "Search by name, SKU or category" : "Search categories by name"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="ep-seg">
          {TYPE_FILTER_OPTS.map(([v, l]) => (
            <button type="button" key={v} className={v === typeFilter ? "on" : ""} onClick={() => setTypeFilter(v)}>
              {l}
            </button>
          ))}
        </div>
        <span className="ep-sub">{countLabel}</span>
      </div>
      <div className="vc-request-list">
        <table className="ep-table">
          <thead>
            <tr>
              {tab === "items" ? (
                <>
                  <th className="ep-th vc-col-check"></th>
                  <th className="ep-th">Name</th>
                  <th className="ep-th text-center">SKU</th>
                  <th className="ep-th text-center">Type</th>
                  <th className="ep-th text-center">Min rating</th>
                </>
              ) : (
                <>
                  <th className="ep-th vc-col-check"></th>
                  <th className="ep-th">Category</th>
                  <th className="ep-th text-center">Type</th>
                  <th className="ep-th text-center">Min rating</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {tab === "items" ? (
              <ItemRequestTable ctx={ctx} filters={filters} selectedIds={selectedProductIds} expandedGroups={expandedGroups} onToggle={toggleProduct} onToggleGroup={toggleGroup} onUpload={onUpload} />
            ) : (
              <CategoryRequestTable ctx={ctx} filters={filters} selectedIds={selectedCategoryIds} onToggle={toggleCategory} onUpload={onUpload} />
            )}
          </tbody>
        </table>
      </div>
      <div className="d-flex items-center justify-between mt-14px">
        <span className="ep-sub">
          <b>{selected.size}</b> selected
        </span>
        <button className="ep-b" data-v="p" disabled={selected.size === 0 || submitting} onClick={submit}>
          Request selected
        </button>
      </div>
    </div>
  );
}
