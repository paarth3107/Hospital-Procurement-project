import type { AuthState } from "../lib/authStore";
import { roleLabel } from "../lib/format";

// Ported from frontend/js/ui.js's setWhoami() call sites -- staffLoginPage.js/
// vendorLoginPage.js/main.js each built this same {name, role, verified}
// shape by hand inline before calling setWhoami(). Computed once here and
// read by both the sidebar identity block and the topbar's user menu
// (vanilla's renderUserMenu() actually scraped the sidebar's own `#whoami`
// DOM text for the role line as its one source of truth -- a DOM-reading
// trick this replaces with just computing it once and using it in both
// places directly).
export interface Identity {
  name: string;
  role: string;
  verified: boolean;
}

export function identityFor(auth: AuthState): Identity {
  if (auth.actorType === "vendor" && auth.vendor) {
    return { name: auth.vendor.legal_name, role: `Vendor #${auth.vendor.id}`, verified: auth.vendor.status === "active" };
  }
  if (auth.user) {
    return { name: auth.user.full_name, role: roleLabel(auth.user.role) + (auth.user.approval_tier ? ` · Tier ${auth.user.approval_tier}` : ""), verified: false };
  }
  return { name: "", role: "", verified: false };
}

export const initials = (name: string): string =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
