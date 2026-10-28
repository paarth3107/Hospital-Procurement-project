import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { Category, ProcurementType } from "../../lib/types";
import { useModal } from "../../components/useModal";
import { Req } from "../../components/Req";
import { FieldError } from "../../components/FieldError";
import { toastError, toastSuccess } from "../../lib/toastStore";
import { RequiredDocsPicker, type RequiredDocsPickerHandle } from "../../components/RequiredDocsPicker";

// Ported 1:1 from frontend/js/pages/catalog/categoryForm.js's openCategoryForm().
// Rendered inline into the page (not a portal dialog) -- same as the
// vanilla version, which drops this into a `host` div and scrolls it into
// view, rather than popping an overlay over the card grid.
const TYPE_OPTS: [ProcurementType, string][] = [
  ["item", "Item"],
  ["asset", "Asset"],
  ["service", "Service"],
];

export function CategoryFormPanel({
  category,
  onSaved,
  onCancel,
}: {
  category: Category | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [procurementType, setProcurementType] = useState<ProcurementType>(category?.procurement_type ?? "item");
  const [minRating, setMinRating] = useState(category?.min_mapping_rating != null ? String(category.min_mapping_rating) : "");
  const [requiredDocs, setRequiredDocs] = useState<string[]>(category?.required_documents ?? []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const docsRef = useRef<RequiredDocsPickerHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { chooseAsync, modalElement } = useModal();

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const checkName = (v: string) => {
    const err = v.trim() ? "" : "Category name is required.";
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
    const payload: Record<string, unknown> = {
      name: name.trim(),
      procurement_type: category ? category.procurement_type : procurementType,
      min_mapping_rating: minRating === "" ? null : Number(minRating),
      required_documents: docsRef.current?.getValue() ?? requiredDocs,
    };
    try {
      // An item's own minimum rating overrides its category's. If some items in this
      // category set one, ask whether they should now follow the category instead.
      if (category && payload.min_mapping_rating !== category.min_mapping_rating) {
        const items = (await api<{ category_id: number; min_mapping_rating: number | null; name: string }[]>(`/products?procurement_type=${category.procurement_type}`)).filter(
          (p) => p.category_id === category.id && p.min_mapping_rating != null && p.min_mapping_rating !== payload.min_mapping_rating
        );
        if (items.length) {
          const list = items.map((p) => `${p.name} (${p.min_mapping_rating})`).join(", ");
          const choice = await chooseAsync(
            `${items.length} item(s) in this category set their own minimum rating, which overrides the category's: ${list}. Should they follow the category minimum${
              payload.min_mapping_rating == null ? " (none)" : ` (${payload.min_mapping_rating})`
            } instead?`,
            [
              { value: "follow", label: "Yes, make them follow the category" },
              { value: "keep", label: "No, keep their own minimums" },
            ],
            "Items with their own minimum"
          );
          if (choice === null) {
            setSaving(false);
            return;
          }
          payload.apply_minimum_to_items = choice === "follow";
        }
      }
      await api(category ? `/categories/${category.id}` : "/categories", {
        method: category ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toastSuccess(`${category ? "Updated" : "Added"} category "${payload.name}".`);
      onSaved(`${category ? "Updated" : "Added"} category ${payload.name}.`);
    } catch (err) {
      const message = `Could not save category "${payload.name}": ` + (err instanceof Error ? err.message : String(err));
      setError(message);
      toastError(message);
      setSaving(false);
    }
  };

  return (
    <div ref={panelRef}>
      <form className="catalog-form ep-form gap-16px" noValidate onSubmit={submit}>
        <div className="fs-18px fw-800">{category ? "Edit" : "New"} category</div>
        <div className="ep-pane ep-pane-pad">
          <div className="ep-form-grid grid-cols-1fr-1fr-1fr">
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
            <div className="ep-field">
              <div className="ep-k">Procurement type</div>
              <select className="input" disabled={!!category} value={procurementType} onChange={(e) => setProcurementType(e.target.value as ProcurementType)}>
                {TYPE_OPTS.map(([t, l]) => (
                  <option value={t} key={t}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="ep-field">
              <div className="ep-k">Min vendor rating to map (optional)</div>
              <input className="input" type="number" step="any" min={0} max={100} value={minRating} onChange={(e) => setMinRating(e.target.value)} />
            </div>
          </div>
          <p className="hint mt-10px">Set a minimum only for restricted or critical categories (implants, high-value equipment, critical AMC).</p>
          <div className="ep-k margin-14px-0-8px">Documents required from a vendor to be mapped to this category</div>
          <RequiredDocsPicker ref={docsRef} value={requiredDocs} onChange={setRequiredDocs} />
        </div>
        <div className="d-flex gap-8px">
          <button type="submit" className="ep-b" data-v="p" disabled={saving}>
            {category ? "Save changes" : "Add category"}
          </button>
          <button type="button" className="ep-b" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {error && <div className="result err">{error}</div>}
      </form>
      {modalElement}
    </div>
  );
}
