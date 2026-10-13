import { api } from "./api";
import type { MappingHistoryEntry, VendorMapping } from "./types";

// Ported from frontend/js/pages/mappings/mappingActions.js -- the API calls
// only. The vanilla version also owned the modalPrompt/modalConfirm calls
// and a "which of the two pages' result div is visible" lookup (a real bug
// once, see the plan file) -- here, each page's own component prompts for a
// reason/confirmation itself (useModal) and shows its own error state, so
// neither of those is needed.
const post = <T = VendorMapping>(path: string, body?: unknown) =>
  api<T>(path, body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });

export function createMapping(vendorId: number, target: { category_id: number } | { product_master_id: number }) {
  return post<VendorMapping>("/mappings", { vendor_id: vendorId, ...target });
}
export function approveMapping(id: number) {
  return post(`/mappings/${id}/approve`);
}
export function rejectMapping(id: number, reason: string) {
  return post(`/mappings/${id}/reject`, { reason });
}
export function suspendMapping(id: number, reason: string) {
  return post(`/mappings/${id}/suspend`, { reason });
}
export function reinstateMapping(id: number) {
  return post(`/mappings/${id}/reinstate`);
}
export function mappingHistory(id: number) {
  return api<MappingHistoryEntry[]>(`/mappings/${id}/history`);
}
