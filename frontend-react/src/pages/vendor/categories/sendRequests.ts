import { api } from "../../../lib/api";

// Ported 1:1 from frontend/js/pages/vendorCategories/categoryRequests.js's
// sendRequests()/submitCategoryRequests() and itemRequests.js's
// submitItemRequests().
export async function sendRequests(bodies: Record<string, unknown>[]): Promise<{ created: number; failed: string[] }> {
  let created = 0;
  const failed: string[] = [];
  for (const body of bodies) {
    try {
      await api("/vendor-portal/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      created++;
    } catch (err) {
      failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { created, failed };
}

export const submitCategoryRequests = (ids: Set<number>) => sendRequests([...ids].map((id) => ({ category_id: id })));
export const submitItemRequests = (ids: Set<number>) => sendRequests([...ids].map((id) => ({ product_master_id: id })));
