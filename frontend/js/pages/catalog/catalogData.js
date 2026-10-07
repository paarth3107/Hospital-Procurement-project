import { api } from "../../api.js";

// Shared, cached fetch for the 4 Catalog sidebar screens (Product List, Add
// Product, Category List, Sub-Category List, 2026-10-07) -- one dataset
// viewed 4 ways, so it's fetched once and reused across sidebar clicks
// instead of every screen re-fetching products/categories/subcategories/
// mappings on its own. Any screen that mutates something calls
// loadCatalogData(true) to force a refresh before the next screen reads it.
let categories = [];
let subCategories = [];
let products = [];
let mappings = [];
let loaded = false;

export async function loadCatalogData(force = false) {
  if (!loaded || force) {
    [products, categories, subCategories, mappings] = await Promise.all([api("/products"), api("/categories"), api("/subcategories"), api("/mappings")]);
    loaded = true;
  }
  return { categories, subCategories, products, mappings };
}

// Set by Product List's Edit button, read by Add Product on load, then
// cleared -- the "set state, then switchView" deep-link pattern already used
// elsewhere in this app (openTenderById, openTenderReview, openTenderAward).
let editingProductId = null;
export const setEditingProductId = (id) => (editingProductId = id);
export const takeEditingProductId = () => {
  const id = editingProductId;
  editingProductId = null;
  return id;
};
