import { useEffect, useState } from "react";
import { switchView } from "../../lib/bridge";
import { loadCatalogData, takeEditingProductId } from "../../lib/catalogCache";
import { setFlash } from "../../lib/flash";
import type { CatalogProduct, Category, ProcurementType, SubCategory } from "../../lib/types";
import { TypeTag } from "../../components/Tag";
import { ProductForm } from "./ProductForm";
import { ITEM_FIELDS, ASSET_FIELDS, SERVICE_FIELDS } from "./catalogFieldDefs";

// Ported 1:1 from frontend/js/pages/catalog/addProductPage.js. Doubles as
// the edit screen, same as Vuexy's own Add Product page: Product List's
// Edit button sets an id via the catalogData.js bridge and switches here,
// which reads and clears it on load. Creating new shows a type switch
// (Item/Asset/Service) above a blank form; editing fixes the type.
const TYPE_OPTS: [ProcurementType, string][] = [
  ["item", "Item"],
  ["asset", "Asset"],
  ["service", "Service"],
];
const FIELDS_BY_TYPE: Record<ProcurementType, typeof ITEM_FIELDS> = { item: ITEM_FIELDS, asset: ASSET_FIELDS, service: SERVICE_FIELDS };
const LABEL_BY_TYPE: Record<ProcurementType, string> = { item: "Item", asset: "Asset", service: "Service" };

export function AddProductPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [addType, setAddType] = useState<ProcurementType>("item");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await loadCatalogData();
        setCategories(data.categories);
        setSubCategories(data.subCategories);
        const id = takeEditingProductId();
        setEditingProduct(id ? data.products.find((p) => p.id === id) ?? null : null);
        setLoaded(true);
      } catch (err) {
        setError("Could not load catalog: " + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, []);

  const onSaved = async (message: string) => {
    await loadCatalogData(true); // force a refresh -- Product List reads this cache next
    // Flash the success message on the destination screen rather than
    // showing it here then immediately switching away -- same pattern
    // vendorDashboardPage.js (and now lib/flash.ts) uses for a message that
    // must survive a switchView() into another page's own async load.
    setFlash(message);
    switchView("catalog-list");
  };
  const onCancel = () => switchView("catalog-list");

  if (error) return <div className="result err">{error}</div>;
  if (!loaded) return null;

  const type = editingProduct ? editingProduct.procurement_type : addType;

  return (
    <div className="d-flex flex-col gap-16px">
      <div className="d-flex items-baseline gap-14px flex-wrap">
        <span className="fs-18px fw-800">{editingProduct ? `Edit ${editingProduct.name}` : "Add a new catalog entry"}</span>
        {editingProduct && <TypeTag type={editingProduct.procurement_type} />}
      </div>
      {!editingProduct && (
        <div className="ep-seg self-start">
          {TYPE_OPTS.map(([t, l]) => (
            <button key={t} className={t === addType ? "on" : ""} onClick={() => setAddType(t)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <ProductForm
        key={type}
        procurementType={type}
        typeLabel={LABEL_BY_TYPE[type]}
        typeFields={FIELDS_BY_TYPE[type]}
        product={editingProduct}
        categories={categories}
        subCategories={subCategories}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    </div>
  );
}
