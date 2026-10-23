import { useCallback, useEffect, useState } from "react";
import { loadCatalogData } from "../../lib/catalogCache";
import type { Category, CatalogProduct } from "../../lib/types";
import { ImgPlaceholder } from "../../components/ImgPlaceholder";
import { IconActionButton } from "../../components/IconActionButton";
import { Tag, TypeTag } from "../../components/Tag";
import { docLabel } from "../../lib/constants";
import { CategoryFormPanel } from "./CategoryFormPanel";

// Ported 1:1 from frontend/js/pages/catalog/categoryListPage.js. Shares its
// data cache (catalogData.js) with the still-vanilla Product List/Add
// Product screens via the window bridge -- see
// .claude-notes/REACT-MIGRATION-PLAN.md's Phase 3 entry.
export function CategoryListPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [formFor, setFormFor] = useState<Category | null | undefined>(undefined); // undefined = closed, null = new, Category = editing

  const load = useCallback(async (force = false) => {
    try {
      const data = await loadCatalogData(force);
      setCategories(data.categories);
      setProducts(data.products);
      setError("");
    } catch (err) {
      setError("Could not load categories: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const afterSave = async (message: string) => {
    setFormFor(undefined);
    await load(true);
    setFlash(message);
  };

  if (error && !categories.length) {
    return <div className="result err">{error}</div>;
  }

  return (
    <div className="d-flex flex-col gap-16px">
      <div className="d-flex items-center gap-14px flex-wrap">
        <div className="hint flex-1">restricted categories need a minimum vendor rating to map</div>
        <button className="ep-b" onClick={() => setFormFor(null)}>
          + New category
        </button>
      </div>
      {formFor !== undefined && <CategoryFormPanel category={formFor} onSaved={afterSave} onCancel={() => setFormFor(undefined)} />}
      {!categories.length ? (
        <div className="ep-pane ep-pane-pad hint">No categories yet.</div>
      ) : (
        <div className="ep-grid grid-cols-repeatauto-fitminmax260px1fr">
          {categories.map((c) => {
            const count = products.filter((p) => p.category_id === c.id).length;
            return (
              <div className="ep-category-card" key={c.id}>
                <div className="ep-category-card-head justify-between">
                  <div className="d-flex items-center gap-14px minw-0">
                    <ImgPlaceholder iconName="tag" size="md" />
                    <div className="minw-0">
                      <div className="fw-700 fs-15px ep-clip" title={c.name}>
                        {c.name}
                      </div>
                      <div className="ep-sub">{count} item(s)</div>
                    </div>
                  </div>
                  <IconActionButton icon="edit" label="Edit" onClick={() => setFormFor(c)} />
                </div>
                <div className="d-flex items-center gap-8px flex-wrap">
                  <TypeTag type={c.procurement_type} />
                  {c.min_mapping_rating != null && <Tag text={`Min rating ${c.min_mapping_rating}`} tone="att" />}
                </div>
                {c.required_documents.length > 0 && <div className="ep-sub">Needs: {c.required_documents.map(docLabel).join(", ")}</div>}
              </div>
            );
          })}
        </div>
      )}
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
