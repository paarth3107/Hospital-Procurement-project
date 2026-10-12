import type { Category, CatalogProduct, VendorDocument, VendorMapping } from "../../../lib/types";

// Shared context every request-table component reads from -- ported from
// frontend/js/pages/vendorCategories/vendorCategoriesPage.js's `ctx` object.
export interface RequestCtx {
  docsByKey: Map<string, VendorDocument>;
  categories: Category[];
  products: CatalogProduct[];
  categoryById: Map<number, Category>;
  mappingByCategory: Map<number, VendorMapping>;
  mappingByProduct: Map<number, VendorMapping>;
}

export type RequestTab = "items" | "categories";
export interface RequestFilters {
  search: string;
  typeFilter: string;
}
