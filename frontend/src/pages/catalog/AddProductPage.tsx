import { useEffect, useState } from "react";
import { switchView } from "../../lib/bridge";
import { loadCatalogData, takeEditingProductId } from "../../lib/catalogCache";
import { setFlash } from "../../lib/flash";
import type { CatalogProduct, Category, SubCategory } from "../../lib/types";
import { ProductForm } from "./ProductForm";

// Ported 1:1 from frontend/js/pages/catalog/addProductPage.js. Doubles as
// the edit screen, same as Vuexy's own Add Product page: Product List's
// Edit button sets an id via the catalogData.js bridge and switches here,
// which reads and clears it on load. Creating new shows a type switch
// (Item/Asset/Service); editing fixes the type. The switch itself now
// lives inside ProductForm (2026-10-15, user-directed) -- see its own
// comment for why.

export function AddProductPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
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

  return (
    <div className="d-flex flex-col gap-16px">
      <ProductForm product={editingProduct} categories={categories} subCategories={subCategories} onSaved={onSaved} onCancel={onCancel} />
    </div>
  );
}
