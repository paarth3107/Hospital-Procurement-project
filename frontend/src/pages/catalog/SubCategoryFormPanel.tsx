import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { Category, SubCategory } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/catalog/subCategoryForm.js's
// openSubCategoryForm(). Deliberately no rating/required-documents override
// here -- only the category and item levels carry those gates.
export function SubCategoryFormPanel({
  subCategory,
  categories,
  onSaved,
  onCancel,
}: {
  subCategory: SubCategory | null;
  categories: Category[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(subCategory?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(subCategory?.category_id ?? categories[0]?.id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      name: name.trim(),
      category_id: subCategory ? subCategory.category_id : Number(categoryId),
    };
    try {
      await api(subCategory ? `/subcategories/${subCategory.id}` : "/subcategories", {
        method: subCategory ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved(`${subCategory ? "Updated" : "Added"} sub-category ${payload.name}.`);
    } catch (err) {
      setError("Could not save: " + (err instanceof Error ? err.message : String(err)));
      setSaving(false);
    }
  };

  return (
    <div ref={panelRef}>
      <form className="catalog-form ep-form gap-16px" onSubmit={submit}>
        <div className="fs-18px fw-800">{subCategory ? "Edit" : "New"} sub-category</div>
        <div className="ep-pane ep-pane-pad">
          <div className="ep-form-grid grid-cols-1fr-1fr">
            <div className="ep-field">
              <div className="ep-k">Category</div>
              <select className="input" disabled={!!subCategory} value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
                {categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name} ({c.procurement_type})
                  </option>
                ))}
              </select>
            </div>
            <div className="ep-field">
              <div className="ep-k">Name</div>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="d-flex gap-8px">
          <button type="submit" className="ep-b" data-v="p" disabled={saving}>
            {subCategory ? "Save changes" : "Add sub-category"}
          </button>
          <button type="button" className="ep-b" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {error && <div className="result err">{error}</div>}
      </form>
    </div>
  );
}
