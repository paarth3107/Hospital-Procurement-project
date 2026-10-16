import { api } from "./api";
import type { Category, SubCategory, CatalogProduct, VendorLookup, VendorMapping, Rating } from "./types";

// Shared, cached fetch for the Catalog screens (Product List, Add Product,
// Category List, Sub-Category List) AND the Mapping/Ratings screens, which
// read overlapping reference data (vendors, categories, subcategories,
// products, mappings, ratings) -- one dataset viewed many ways, fetched
// once per session and reused across navigations instead of every screen
// re-fetching the same handful of tables on its own. Any screen that
// mutates something calls loadCatalogData(true) to force a refresh before
// the next screen reads it, or (for the two high-frequency actions below)
// patches the one row that actually changed in place instead.
//
// Extended 2026-10-15, user-reported via the browser's own network panel:
// Mapping Matrix and Mapping Requests each independently fetched all six of
// these on every visit (lib/mappingData.ts used to call its own separate
// api() endpoints instead of this cache); Ratings fetched vendors and
// ratings separately again on top of that; Product List's own categories/
// subcategories/products/mappings overlapped with both. All four now read
// from this one cache.
//
// Ported from frontend/js/pages/catalog/catalogData.js, which originally
// exposed these same functions on `window` so a still-vanilla Catalog screen
// and an already-React one could share one real cache during the Phase 3
// migration (see .claude-notes/REACT-MIGRATION-PLAN.md). Now that every
// screen that reads this is React, in this same bundle, that bridge has no
// vanilla side left to talk to -- plain module state here is already shared
// between them, so the vanilla file (and its window.* assignments) was
// deleted rather than kept as a pointless indirection. If a still-vanilla
// page ever needs this data again, re-add the window bridge then, don't
// guess at it now.
export interface CatalogData {
  vendors: VendorLookup[];
  categories: Category[];
  subCategories: SubCategory[];
  products: CatalogProduct[];
  mappings: VendorMapping[];
  ratings: Rating[];
}

let vendors: VendorLookup[] = [];
let categories: Category[] = [];
let subCategories: SubCategory[] = [];
let products: CatalogProduct[] = [];
let mappings: VendorMapping[] = [];
let ratings: Rating[] = [];
let loaded = false;

export async function loadCatalogData(force = false): Promise<CatalogData> {
  if (!loaded || force) {
    [vendors, products, categories, subCategories, mappings, ratings] = await Promise.all([
      api<VendorLookup[]>("/vendors/lookup"),
      api<CatalogProduct[]>("/products"),
      api<Category[]>("/categories"),
      api<SubCategory[]>("/subcategories"),
      api<VendorMapping[]>("/mappings"),
      api<Rating[]>("/ratings"),
    ]);
    loaded = true;
  }
  return { vendors, categories, subCategories, products, mappings, ratings };
}

// Patches one mapping's row into the cache in place, no refetch -- used
// after a mapping decision (approve/reject/suspend/reinstate), which
// already hands back the updated VendorMapping (mappings.py's
// response_model). Mirrors mappingData.ts's own withPatchedMapping, which
// does the same thing for a page's own already-loaded MappingData; this one
// keeps the shared cache in sync too, so the next page that reads it (or
// this one, after a remount) doesn't see stale data without a full reload.
export function patchCachedMapping(updated: VendorMapping) {
  mappings = mappings.some((m) => m.id === updated.id) ? mappings.map((m) => (m.id === updated.id ? updated : m)) : [...mappings, updated];
}

// Same idea, for a manual rating adjustment's response (ratings.py's
// response_model on PATCH /ratings/{vendor_id}).
export function patchCachedRating(updated: Rating) {
  ratings = ratings.some((r) => r.id === updated.id) ? ratings.map((r) => (r.id === updated.id ? updated : r)) : [...ratings, updated];
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
