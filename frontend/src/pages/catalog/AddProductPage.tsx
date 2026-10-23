import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { switchView } from "../../lib/bridge";
import { loadCatalogData } from "../../lib/catalogCache";
import { setFlash } from "../../lib/flash";
import type { CatalogProduct, Category, SubCategory } from "../../lib/types";
import { ProductForm } from "./ProductForm";

// Ported 1:1 from frontend/js/pages/catalog/addProductPage.js. Doubles as
// the edit screen, same as Vuexy's own Add Product page: Product List's
// Edit button navigates to `/catalog-add/:id`, read here via `useParams()`
// (no id = "new"). Creating new shows a type switch (Item/Asset/Service);
// editing fixes the type. The switch itself now lives inside ProductForm
// (2026-10-15, user-directed) -- see its own comment for why.
//
// Bug fix, 2026-10-23: the id used to come from a `catalogCache.ts` module
// variable (`editingProductId`/`takeEditingProductId`) set by Product List
// just before switching here -- same transient-state pattern as the
// Vendor/Tender/Approvals/Awards/Bid pages, with the same gap: a refresh or
// direct link lost the id, silently falling back to "new product" instead
// of showing anything broken-looking (worse than a redirect, since nothing
// signals the mistake until you notice you're creating a duplicate).

export function AddProductPage() {
  const { id } = useParams();
  const productId = id ? Number(id) : null;
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
        setEditingProduct(productId ? data.products.find((p) => p.id === productId) ?? null : null);
        setLoaded(true);
      } catch (err) {
        setError("Could not load catalog: " + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, [productId]);

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
