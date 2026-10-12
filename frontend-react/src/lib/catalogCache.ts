import { api } from "./api";
import type { Category, SubCategory, CatalogProduct, VendorMapping } from "./types";

// Shared, cached fetch for the 4 Catalog screens (Product List, Add Product,
// Category List, Sub-Category List) -- one dataset viewed 4 ways, fetched
// once and reused across navigations instead of every screen re-fetching on
// its own. Any screen that mutates something calls loadCatalogData(true) to
// force a refresh before the next screen reads it.
//
// Ported from frontend/js/pages/catalog/catalogData.js, which originally
// exposed these same functions on `window` so a still-vanilla Catalog screen
// and an already-React one could share one real cache during the Phase 3
// migration (see .claude-notes/REACT-MIGRATION-PLAN.md). Now that all 4
// Catalog screens are React, in this same bundle, that bridge has no vanilla
// side left to talk to -- plain module state here is already shared between
// them, so the vanilla file (and its window.* assignments) was deleted
// rather than kept as a pointless indirection. If a still-vanilla page ever
// needs this data again, re-add the window bridge then, don't guess at it
// now.
export interface CatalogData {
  categories: Category[];
  subCategories: SubCategory[];
  products: CatalogProduct[];
  mappings: VendorMapping[];
}

let categories: Category[] = [];
let subCategories: SubCategory[] = [];
let products: CatalogProduct[] = [];
let mappings: VendorMapping[] = [];
let loaded = false;

export async function loadCatalogData(force = false): Promise<CatalogData> {
  if (!loaded || force) {
    [products, categories, subCategories, mappings] = await Promise.all([
      api<CatalogProduct[]>("/products"),
      api<Category[]>("/categories"),
      api<SubCategory[]>("/subcategories"),
      api<VendorMapping[]>("/mappings"),
    ]);
    loaded = true;
  }
  return { categories, subCategories, products, mappings };
}

// Set by Product List's Edit button, read by Add Product on load, then
// cleared -- the "set state, then switchView" deep-link pattern already used
// elsewhere in this app.
let editingProductId: number | null = null;
export const setEditingProductId = (id: number | null) => {
  editingProductId = id;
};
export const takeEditingProductId = (): number | null => {
  const id = editingProductId;
  editingProductId = null;
  return id;
};
