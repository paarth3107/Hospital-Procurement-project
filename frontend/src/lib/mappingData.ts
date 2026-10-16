import { loadCatalogData } from "./catalogCache";
import type { Category, CatalogProduct, ProcurementType, SubCategory, VendorLookup, VendorMapping } from "./types";

// Ported from frontend/js/pages/mappings/mappingData.js -- everything the
// Mapping Matrix and Mapping Requests screens need, shaped the way those
// two screens want it (the id-keyed Maps and lookup closures below).
//
// Real bug, found 2026-10-15, user-reported via the browser's own network
// panel: this used to fetch all six of its own tables independently on
// every call, uncached -- so visiting Mapping Matrix then Mapping Requests
// (or either of those, then Product List, which reads several of the same
// tables through catalogCache.ts) re-fetched the identical vendor/category/
// subcategory/product/mapping/rating data every single time. Now just
// reshapes whatever catalogCache.ts already has (fetched once per session,
// shared with the Catalog screens too) instead of re-fetching any of it.
export interface MappingData {
  vendors: VendorLookup[];
  categories: Category[];
  subCategories: SubCategory[];
  products: CatalogProduct[];
  mappings: VendorMapping[];
  vendorById: Map<number, VendorLookup>;
  categoryById: Map<number, Category>;
  subCategoryById: Map<number, SubCategory>;
  productById: Map<number, CatalogProduct>;
  categoryMappingOf: (vendorId: number, categoryId: number) => VendorMapping | undefined;
  itemMappingOf: (vendorId: number, productId: number) => VendorMapping | undefined;
  // No rating row for a (vendor, type) pair = provisional default (services/ratings.py).
  ratingScore: (vendorId: number, type: ProcurementType | string) => number;
}

export async function loadMappingData(force = false): Promise<MappingData> {
  const { vendors, categories, subCategories, products, mappings, ratings } = await loadCatalogData(force);
  const ratingByKey = new Map(ratings.map((r) => [`${r.vendor_id}:${r.procurement_type}`, r]));
  return {
    vendors,
    categories,
    subCategories,
    products,
    mappings,
    vendorById: new Map(vendors.map((v) => [v.id, v])),
    categoryById: new Map(categories.map((c) => [c.id, c])),
    subCategoryById: new Map(subCategories.map((s) => [s.id, s])),
    productById: new Map(products.map((p) => [p.id, p])),
    categoryMappingOf: (vendorId, categoryId) => mappings.find((m) => m.vendor_id === vendorId && m.category_id === categoryId),
    itemMappingOf: (vendorId, productId) => mappings.find((m) => m.vendor_id === vendorId && m.product_master_id === productId),
    ratingScore: (vendorId, type) => ratingByKey.get(`${vendorId}:${type}`)?.overall_score ?? 50,
  };
}

// Real bug, found 2026-10-15: every approve/reject/suspend/reinstate
// action called loadMappingData() all over again afterward -- 6 full-table
// fetches (vendors, categories, subcategories, products, mappings,
// ratings) just to reflect the ONE mapping row the action actually
// changed, each of those endpoints' own decision already returns the
// updated VendorMapping (mappings.py's response_model). Patches that one
// row into the existing data in place instead of refetching anything.
// categoryMappingOf/itemMappingOf have to be rebuilt here, not just left
// pointing at the old array -- they're closures over `mappings` as it was
// at the original loadMappingData() call, so reusing them unchanged would
// silently keep reading stale data forever after the first patch.
export function withPatchedMapping(data: MappingData, updated: VendorMapping): MappingData {
  const mappings = data.mappings.some((m) => m.id === updated.id)
    ? data.mappings.map((m) => (m.id === updated.id ? updated : m))
    : [...data.mappings, updated];
  return {
    ...data,
    mappings,
    categoryMappingOf: (vendorId, categoryId) => mappings.find((m) => m.vendor_id === vendorId && m.category_id === categoryId),
    itemMappingOf: (vendorId, productId) => mappings.find((m) => m.vendor_id === vendorId && m.product_master_id === productId),
  };
}
