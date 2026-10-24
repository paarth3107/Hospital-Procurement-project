// Ported 1:1 from frontend/js/pages/vendorNotifications.js -- the vendor
// portal's notification kinds and the "closing soon" rule, shared by the
// top bell (AppShell) and chromeStore's badge count.
// No "vendor_rejected" kind (2026-10-24, user-directed) -- the backend's
// set_status() builds this notification kind from the vendor's actual
// status value, which can never be "rejected" anymore (reject_vendor()
// sets "blacklisted" directly), so this kind can no longer be produced.
// Left out of the lookup below too, not just the type -- a historical
// notification row with this old kind still renders fine via the generic
// `|| [n.kind, ""]` fallback at the call site, just without the nicer
// label/tone.
export type VendorNotificationKind =
  | "awarded"
  | "regret"
  | "technical_disqualified"
  | "document_verified"
  | "document_rejected"
  | "vendor_active"
  | "vendor_info_requested"
  | "vendor_suspended"
  | "vendor_blacklisted";

export const NOTIFICATION_TONE: Record<string, [label: string, tone: string]> = {
  awarded: ["Awarded", "pos"],
  regret: ["Not selected", "esc"],
  technical_disqualified: ["Technical result", "neg"],
  document_verified: ["Document", "pos"],
  document_rejected: ["Document", "neg"],
  vendor_active: ["Registration", "pos"],
  vendor_info_requested: ["Registration", "esc"],
  vendor_suspended: ["Account", "neg"],
  vendor_blacklisted: ["Account", "neg"],
};

// A tender is "closing soon" if it's still biddable and due within 24
// hours. Synthetic, not persisted -- recomputed fresh wherever it's needed
// (the vendor dashboard's own banner, the top bell) since there's no
// scheduler pre-generating a notification row for it.
export function closingSoonTenders<T extends { can_bid: boolean; bid_due_date: string | null }>(tenders: T[]): T[] {
  const soon = Date.now() + 24 * 3600 * 1000;
  return tenders.filter((t) => t.can_bid && t.bid_due_date && new Date(t.bid_due_date).getTime() < soon);
}
