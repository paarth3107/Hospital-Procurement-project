// Ported 1:1 from frontend/js/kit.js and frontend/js/pages/audit/auditDetail.js.
// Keep these in sync with the vanilla originals until those files are deleted.

export const fmtDateTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

export const ROLE_LABELS: Record<string, string> = {
  procurement_officer: "Procurement Officer",
  category_manager: "Category Manager",
  approving_authority: "Approving Authority",
  system_admin: "System Admin",
};
export const roleLabel = (role: string | null | undefined): string => (role ? ROLE_LABELS[role] || role : "");

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

// Indian digit grouping, rupee sign (ported from kit.js's inr()).
export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

// "tender.vendor_removed" -> "Tender → Vendor Removed" (2026-10-08 format:
// every word capitalized, an arrow instead of a dot).
const titleCase = (s: string): string =>
  s
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

export const actionLabel = (action: string): string => {
  const [domain, ...rest] = action.split(".");
  const verb = rest.join(".").replace(/_/g, " ");
  return verb ? `${titleCase(domain)} → ${titleCase(verb)}` : titleCase(domain);
};

export const pretty = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 1).replace(/[{}"]/g, "").trim() || "—";
  return String(value);
};
