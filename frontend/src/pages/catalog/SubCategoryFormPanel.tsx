import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { Category, SubCategory } from "../../lib/types";
import { Req } from "../../components/Req";
import { FieldError } from "../../components/FieldError";
import { toastError, toastSuccess } from "../../lib/toastStore";

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
  const [nameError, setNameError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const checkName = (v: string) => {
    const err = v.trim() ? "" : "Sub-category name is required.";
    setNameError(err);
    return err;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkName(name)) {
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
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
      toastSuccess(`${subCategory ? "Updated" : "Added"} sub-category "${payload.name}".`);
      onSaved(`${subCategory ? "Updated" : "Added"} sub-category ${payload.name}.`);
    } catch (err) {
      const message = `Could not save sub-category "${payload.name}": ` + (err instanceof Error ? err.message : String(err));
      setError(message);
      toastError(message);
      setSaving(false);
    }
  };

  return (
    <div ref={panelRef}>
      <form className="catalog-form ep-form gap-16px" noValidate onSubmit={submit}>
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
              <div className="ep-k">
                Name
                <Req />
              </div>
              <input
                className="input"
                required
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={(e) => checkName(e.target.value)}
              />
              <FieldError errors={{ name: nameError }} name="name" />
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
