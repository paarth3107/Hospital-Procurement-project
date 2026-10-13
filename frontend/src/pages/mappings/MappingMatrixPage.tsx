import { useCallback, useEffect, useMemo, useState } from "react";
import { loadMappingData, type MappingData } from "../../lib/mappingData";
import type { CatalogProduct } from "../../lib/types";
import { MappingDetailDialog } from "./MappingDetailDialog";
import { useMappingActions } from "./useMappingActions";

// Ported 1:1 from frontend/js/pages/mappings/mappingMatrixPage.js +
// mappingMatrix.js. Pick a vendor first, then drill Type -> Category ->
// Sub-category, and see that one vendor's mapping status against every item
// as a plain list (tick/dash) -- not a vendor x item grid (which still grows
// one axis with catalog size; pinning the vendor and listing items
// vertically is the one that stays readable at scale).
const mark = (state: string | undefined) => (state === "approved" ? "✓" : "—");
const markState = (state: string | undefined) => (state === "approved" ? "approved" : "none");

type DialogTarget = { kind: "category"; categoryId: number } | { kind: "item"; productId: number };

export function MappingMatrixPage() {
  const [data, setData] = useState<MappingData | null>(null);
  const [error, setError] = useState("");
  const [selVendorId, setSelVendorId] = useState<number | null>(null);
  const [selType, setSelType] = useState<string | null>(null);
  const [selCategoryId, setSelCategoryId] = useState<number | null>(null);
  const [selSubCategoryId, setSelSubCategoryId] = useState<number | null>(null);
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await loadMappingData();
      setData(d);
      setError("");
    } catch (err) {
      setError("Could not load mappings: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mappingActions = useMappingActions(() => {
    load();
    setDialogTarget(null);
  });

  // Keep every selection valid as the data/vendor/type changes -- same
  // reasoning (and same fallback order) as mappingMatrix.js's own guards.
  const vendorId = data && !data.vendors.some((v) => v.id === selVendorId) ? data.vendors[0]?.id ?? null : selVendorId;
  const types = useMemo<string[]>(() => [...new Set((data?.categories ?? []).map((c): string => c.procurement_type))], [data]);
  const type = selType && types.includes(selType) ? selType : types[0] ?? null;
  const categoriesOfType = useMemo(() => (data?.categories ?? []).filter((c) => c.procurement_type === type), [data, type]);
  const categoryId = categoriesOfType.some((c) => c.id === selCategoryId) ? selCategoryId : categoriesOfType[0]?.id ?? null;
  const subCategoriesOfCategory = useMemo(() => (data?.subCategories ?? []).filter((s) => s.category_id === categoryId), [data, categoryId]);
  const subCategoryId = subCategoriesOfCategory.some((s) => s.id === selSubCategoryId) ? selSubCategoryId : null;

  if (error && !data) return <div className="result err">{error}</div>;
  if (!data) return null;

  const vendor = data.vendorById.get(vendorId ?? -1);
  const category = categoryId != null ? data.categoryById.get(categoryId) : undefined;
  const empty = data.vendors.length === 0 || data.categories.length === 0;

  const categoryMapping = vendor && category ? data.categoryMappingOf(vendor.id, category.id) : undefined;
  const categoryState = categoryMapping?.state ?? "none";
  const items: CatalogProduct[] = category ? (subCategoryId ? data.products.filter((p) => p.sub_category_id === subCategoryId) : data.products.filter((p) => p.category_id === category.id)) : [];
  const itemSectionLabel = subCategoryId ? data.subCategoryById.get(subCategoryId)?.name ?? "" : category ? `All — ${category.name}` : "";

  return (
    <div className="d-flex flex-col gap-16px">
      <div className="ep-pane overflow-auto">
        {empty ? (
          <div className="ep-pane-pad hint">Add vendors and categories first.</div>
        ) : (
          <>
            <div className="padding-14px-16px d-flex gap-14px flex-wrap items-center border-bottom-1px-solid-ink-18">
              <label className="ep-k">
                Vendor{" "}
                <select className="input w-auto minw-220px" value={vendorId ?? ""} onChange={(e) => setSelVendorId(Number(e.target.value))}>
                  {data.vendors.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-k">
                Type{" "}
                <select
                  className="input w-auto"
                  value={type ?? ""}
                  onChange={(e) => {
                    setSelType(e.target.value);
                    setSelCategoryId(null);
                    setSelSubCategoryId(null);
                  }}
                >
                  {types.map((t) => (
                    <option value={t} key={t}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-k">
                Category{" "}
                <select
                  className="input w-auto minw-220px"
                  value={categoryId ?? ""}
                  onChange={(e) => {
                    setSelCategoryId(Number(e.target.value));
                    setSelSubCategoryId(null);
                  }}
                >
                  {categoriesOfType.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-k">
                Sub-category{" "}
                <select
                  className="input w-auto minw-220px"
                  disabled={!subCategoriesOfCategory.length}
                  value={subCategoryId ?? ""}
                  onChange={(e) => setSelSubCategoryId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">All</option>
                  {subCategoriesOfCategory.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!vendor || !category ? (
              <div className="ep-pane-pad hint">Add vendors and categories first.</div>
            ) : (
              <>
                <div className="ep-pane-pad">
                  <div className="d-flex items-center justify-between gap-14px maxw-640px">
                    <div>
                      <div className="ep-k">Whole-category mapping</div>
                      <div className="fw-600">
                        {vendor.legal_name} → {category.name}
                      </div>
                      <div className="hint">Approves {vendor.legal_name} for every item in this category.</div>
                    </div>
                    <button className="matrix-btn w-60px h-32px" data-s={markState(categoryState)} onClick={() => setDialogTarget({ kind: "category", categoryId: category.id })}>
                      {mark(categoryState)}
                    </button>
                  </div>
                </div>
                <div className="ep-pane-pad border-top-1px-solid-ink-18">
                  <div className="ep-k mb-8px">Item mapping — "{itemSectionLabel}"</div>
                  {items.length ? (
                    <table className="ep-table">
                      <thead>
                        <tr>
                          <th className="ep-th">Code</th>
                          <th className="ep-th">Item</th>
                          <th className="ep-th">Sub-category</th>
                          <th className="ep-th text-center">Mapped</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((p) => {
                          const m = data.itemMappingOf(vendor.id, p.id);
                          const state = m?.state;
                          return (
                            <tr key={p.id}>
                              <td className="ep-cell ep-mono fs-11-5px">{p.code}</td>
                              <td className="ep-cell">
                                {p.name}
                                {p.min_mapping_rating != null && <div className="ep-sub">min rating {p.min_mapping_rating}</div>}
                              </td>
                              <td className="ep-cell">{p.sub_category || "—"}</td>
                              <td className="ep-cell text-center">
                                <button className="matrix-btn w-60px h-32px" data-s={markState(state)} onClick={() => setDialogTarget({ kind: "item", productId: p.id })}>
                                  {mark(state)}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="hint">No items here yet.</div>
                  )}
                </div>
                <div className="d-flex gap-22px flex-wrap padding-10px-16px fs-11-5px text-ink-62 border-top-1px-solid-ink-18">
                  <span>✓ mapped and approved</span>
                  <span>— not mapped (may be pending, suspended or rejected — click for details, or see Mapping requests)</span>
                </div>
              </>
            )}
          </>
        )}
      </div>
      {error && <div className="result err">{error}</div>}
      {mappingActions.error && <div className="result err">{mappingActions.error}</div>}
      {vendor &&
        dialogTarget &&
        (dialogTarget.kind === "category"
          ? (() => {
              const c = data.categoryById.get(dialogTarget.categoryId);
              return c ? (
                <MappingDetailDialog
                  data={data}
                  vendor={vendor}
                  kind="category"
                  target={c}
                  mapping={data.categoryMappingOf(vendor.id, c.id)}
                  actions={mappingActions}
                  onClose={() => setDialogTarget(null)}
                />
              ) : null;
            })()
          : (() => {
              const p = data.productById.get(dialogTarget.productId);
              return p ? (
                <MappingDetailDialog
                  data={data}
                  vendor={vendor}
                  kind="item"
                  target={p}
                  mapping={data.itemMappingOf(vendor.id, p.id)}
                  actions={mappingActions}
                  onClose={() => setDialogTarget(null)}
                />
              ) : null;
            })())}
      {mappingActions.modalElement}
    </div>
  );
}
