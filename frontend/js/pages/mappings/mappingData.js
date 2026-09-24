import { api } from "../../api.js";

// Everything the mapping screens need, fetched once per refresh and handed
// to whichever tab is showing. Ratings are one row per (vendor, type), so
// they're keyed "vendorId:type" for quick lookup.
export async function loadMappingData() {
  const [vendors, categories, products, mappings, ratings] = await Promise.all([
    api("/vendors/lookup"),
    api("/categories"),
    api("/products"),
    api("/mappings"),
    api("/ratings"),
  ]);
  const ratingByKey = new Map(ratings.map((r) => [`${r.vendor_id}:${r.procurement_type}`, r]));
  return {
    vendors,
    categories,
    products,
    mappings,
    vendorById: new Map(vendors.map((v) => [v.id, v])),
    categoryById: new Map(categories.map((c) => [c.id, c])),
    productById: new Map(products.map((p) => [p.id, p])),
    categoryMappingOf: (vendorId, categoryId) => mappings.find((m) => m.vendor_id === vendorId && m.category_id === categoryId),
    itemMappingOf: (vendorId, productId) => mappings.find((m) => m.vendor_id === vendorId && m.product_master_id === productId),
    ratingScore: (vendorId, type) => {
      const r = ratingByKey.get(`${vendorId}:${type}`);
      return r ? r.overall_score : 50; // no row = provisional default (services/ratings.py)
    },
  };
}
