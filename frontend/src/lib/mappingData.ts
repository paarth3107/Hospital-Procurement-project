import { api } from "./api";
import type { Category, CatalogProduct, ProcurementType, Rating, SubCategory, VendorLookup, VendorMapping } from "./types";

// Ported from frontend/js/pages/mappings/mappingData.js -- everything the
// Mapping Matrix and Mapping Requests screens need, fetched together and
// handed to whichever page is showing. No caching (unlike catalogCache.ts):
// the vanilla version always refetched fresh on every page load too, and
// both pages are React in the same bundle now, so there's no cross-boundary
// bridge to build here at all -- each page just calls this directly.
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

export async function loadMappingData(): Promise<MappingData> {
  const [vendors, categories, subCategories, products, mappings, ratings] = await Promise.all([
    api<VendorLookup[]>("/vendors/lookup"),
    api<Category[]>("/categories"),
    api<SubCategory[]>("/subcategories"),
    api<CatalogProduct[]>("/products"),
    api<VendorMapping[]>("/mappings"),
    api<Rating[]>("/ratings"),
  ]);
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
