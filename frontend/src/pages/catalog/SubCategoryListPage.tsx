import { useCallback, useEffect, useState } from "react";
import { loadCatalogData } from "../../lib/catalogCache";
import type { Category, SubCategory } from "../../lib/types";
import { TypeTag } from "../../components/Tag";
import { SubCategoryFormPanel } from "./SubCategoryFormPanel";

// Ported 1:1 from frontend/js/pages/catalog/subCategoryListPage.js. Shares
// catalogData.js's cache with the still-vanilla Product List/Add Product
// screens via the window bridge -- see
// .claude-notes/REACT-MIGRATION-PLAN.md's Phase 3 entry.
export function SubCategoryListPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [formFor, setFormFor] = useState<SubCategory | null | undefined>(undefined); // undefined = closed, null = new, SubCategory = editing

  const load = useCallback(async (force = false) => {
    try {
      const data = await loadCatalogData(force);
      setCategories(data.categories);
      setSubCategories(data.subCategories);
      setError("");
    } catch (err) {
      setError("Could not load sub-categories: " + (err instanceof Error ? err.message : String(err)));
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

  if (error && !subCategories.length && !categories.length) {
    return <div className="result err">{error}</div>;
  }

  return (
    <div className="d-flex flex-col gap-16px">
      {formFor !== undefined && <SubCategoryFormPanel subCategory={formFor} categories={categories} onSaved={afterSave} onCancel={() => setFormFor(undefined)} />}
      <div className="ep-pane">
        <div className="ep-pane-head">
          <span>Sub-Categories</span>
          <span className="d-flex items-center gap-10px">
            <span className="ep-k">used by the vendor-mapping drill-down</span>
            <button className="ep-b" onClick={() => setFormFor(null)}>
              + New sub-category
            </button>
          </span>
        </div>
        <table className="ep-table">
          <thead>
            <tr>
              {["Name", "Category", "Type", ""].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!subCategories.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={4}>
                  No sub-categories yet.
                </td>
              </tr>
            ) : (
              subCategories.map((s) => {
                const c = categories.find((x) => x.id === s.category_id);
                return (
                  <tr key={s.id}>
                    <td className="ep-cell fw-600">{s.name}</td>
                    <td className="ep-cell">{c?.name ?? "—"}</td>
                    <td className="ep-cell">{c ? <TypeTag type={c.procurement_type} /> : "—"}</td>
                    <td className="ep-cell text-right">
                      <button className="ep-b" onClick={() => setFormFor(s)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
