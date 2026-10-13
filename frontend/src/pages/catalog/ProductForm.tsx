import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { loadCatalogData } from "../../lib/catalogCache";
import type { CatalogProduct, Category, ProcurementType, SubCategory } from "../../lib/types";
import { Tag, TypeTag } from "../../components/Tag";
import { Icon } from "../../lib/icons";
import { FormField } from "../../components/FormField";
import { useModal } from "../../components/useModal";
import { initialFieldValues, readFieldValues, type FieldDef } from "../../lib/formFields";
import { CoreDetailsSection, type CoreDetailsHandle } from "./CoreDetailsSection";

// Ported 1:1 from frontend/js/pages/catalog/productForm.js -- the one form
// skeleton shared by the Item, Asset and Service forms. Item/Asset/Service
// only differ in `procurementType`/`typeLabel`/`typeFields` (catalogFieldDefs.ts),
// same as the vanilla itemForm.js/assetForm.js/serviceForm.js did.
export function ProductForm({
  procurementType,
  typeLabel,
  typeFields,
  product,
  categories,
  subCategories,
  onSaved,
  onCancel,
}: {
  procurementType: ProcurementType;
  typeLabel: string;
  typeFields: FieldDef[];
  product: CatalogProduct | null;
  categories: Category[];
  subCategories: SubCategory[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(product?.code ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(product?.category_id ?? "");
  const [subCategoryId, setSubCategoryId] = useState<number | "">(product?.sub_category_id ?? "");
  const [localSubCategories, setLocalSubCategories] = useState<SubCategory[]>(subCategories);
  const [typeRaw, setTypeRaw] = useState<Record<string, string>>(() => initialFieldValues(typeFields, product?.type_specific_attrs));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const coreRef = useRef<CoreDetailsHandle>(null);
  const { promptAsync, alertAsync, modalElement } = useModal();

  const typeCategories = categories.filter((c) => c.procurement_type === procurementType);
  const subCategoryOptions = localSubCategories.filter((s) => s.category_id === categoryId);

  const addSubCategory = async () => {
    if (!categoryId) {
      await alertAsync("Pick a category first.");
      return;
    }
    const subName = await promptAsync("New sub-category name");
    if (!subName) return;
    try {
      const created = await api<SubCategory>("/subcategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: subName, category_id: categoryId }),
      });
      setLocalSubCategories((s) => [...s, created]);
      setSubCategoryId(created.id);
      loadCatalogData(true); // keep the shared cache in sync for Category/Sub-Category List too
    } catch (err) {
      setError("Could not add sub-category: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || null,
      procurement_type: procurementType,
      category_id: Number(categoryId),
      sub_category_id: subCategoryId ? Number(subCategoryId) : null,
      ...coreRef.current?.getValue(),
      type_specific_attrs: readFieldValues(typeFields, typeRaw),
    };
    try {
      await api(product ? `/products/${product.id}` : "/products", {
        method: product ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onSaved(`${product ? "Updated" : "Added"} ${payload.name}.`);
    } catch (err) {
      setError("Could not save: " + (err instanceof Error ? err.message : String(err)));
      setSaving(false);
    }
  };

  const group = (title: string, body: React.ReactNode) => (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>{title}</span>
      </div>
      <div className="padding-6px-16px-14px">{body}</div>
    </div>
  );

  return (
    <form className="catalog-form ep-form gap-16px" onSubmit={submit}>
      <div className="d-flex items-center justify-between gap-14px flex-wrap">
        <div className="d-flex items-baseline gap-12px">
          <span className="fs-18px fw-800">
            {product ? "Edit" : "New"} {typeLabel.toLowerCase()}
          </span>
          <TypeTag type={procurementType} />
        </div>
        <div className="d-flex gap-8px">
          <button type="button" className="ep-b" onClick={onCancel}>
            Discard
          </button>
          <button type="submit" className="ep-b" data-v="p" disabled={saving}>
            {product ? "Save changes" : "Add to catalog"}
          </button>
        </div>
      </div>
      <div className="ep-grid grid-cols-2fr-1fr">
        <div className="d-flex flex-col gap-16px minw-0">
          {group(
            "Item Information",
            <div className="ep-form-grid grid-cols-1fr-1fr-1fr">
              <div className="ep-field">
                <div className="ep-k">Code / SKU</div>
                <input className="input" required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="ep-field col-span-2">
                <div className="ep-k">Name</div>
                <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="ep-field col-span-3">
                <div className="ep-k">Description / specification</div>
                <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
          )}
          {group(
            `Core Details — tick the ones that apply to this ${typeLabel.toLowerCase()}`,
            <div className="core-details">
              <CoreDetailsSection ref={coreRef} product={product} />
            </div>
          )}
          {group(
            `${typeLabel} Details`,
            <div className="type-details d-flex flex-col gap-12px pt-10px">
              {typeFields.map((f) => (
                <FormField key={f.name} field={f} raw={typeRaw} onChange={(fieldName, value) => setTypeRaw((r) => ({ ...r, [fieldName]: value }))} />
              ))}
            </div>
          )}
        </div>
        <div className="d-flex flex-col gap-16px minw-0">
          {group(
            "Product Image",
            <div className="ep-thumb ep-thumb-lg d-flex flex-col items-center justify-center gap-6px text-center">
              <span className="text-ink-35">
                <Icon name="upload" size={26} />
              </span>
              <div className="fs-12-5px fw-600 text-ink-55">Drag &amp; drop an image, or browse</div>
              <div className="ep-sub">Reserved for later — no upload yet</div>
            </div>
          )}
          {group(
            "Organize",
            <div className="d-flex flex-col gap-14px">
              <div className="ep-field">
                <div className="ep-k">Category</div>
                <select
                  className="input"
                  required
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(Number(e.target.value));
                    setSubCategoryId("");
                  }}
                >
                  <option value="">— select a category —</option>
                  {typeCategories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ep-field">
                <div className="ep-k">Sub-category (optional)</div>
                <div className="d-flex gap-6px">
                  <select className="input flex-1" value={subCategoryId} onChange={(e) => setSubCategoryId(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">— none —</option>
                    {subCategoryOptions.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="ep-b" onClick={addSubCategory}>
                    + New
                  </button>
                </div>
              </div>
              {product && (
                <div className="ep-field">
                  <div className="ep-k">Status</div>
                  <div className="mt-2px">{product.active ? <Tag text="Active" tone="pos" /> : <Tag text="Inactive" tone="neg" />}</div>
                  <div className="ep-sub mt-4px">Change this from the Product List tab.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {error && <div className="result err">{error}</div>}
      {modalElement}
    </form>
  );
}
