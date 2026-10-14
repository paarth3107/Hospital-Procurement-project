import { Navigate, useLocation } from "react-router-dom";
import { useAuthState } from "../lib/authStore";
import { ALL_STAFF_TAB_VIEWS, ROLE_TABS, DEFAULT_VIEW_BY_ROLE } from "../lib/constants";
import { AppShell } from "./AppShell";

// Enforces the same role-gate frontend/js/nav.js's switchView() always
// had, but at the ROUTE level, not just inside the switchView() convenience
// function -- a direct URL/hash edit or the back/forward buttons reach a
// route without ever calling switchView(), so the gate has to live here too,
// not only in lib/router.ts's wrapper. A hidden sidebar tab is not enough:
// the server refuses the data either way, but this avoids a confusing
// blank/half-broken page in between.
export function ProtectedLayout() {
  const auth = useAuthState();
  const { pathname } = useLocation();

  if (!auth.token) return <Navigate to="/login" replace />;

  // Real bug, found 2026-10-14: a page refresh only restores token/actorType
  // from sessionStorage synchronously (AuthBoot.tsx) -- `user`/`vendor`
  // always start null again and are re-fetched async right after. In that
  // gap, `ROLE_TABS[auth.user?.role ?? ""]` resolves to an empty array for
  // EVERY staff role, not because the role actually lacks this tab but
  // because the role hasn't loaded yet -- which used to read as "this role
  // can't be here" and fire the fallback Navigate below on every single
  // refresh, regardless of which page was open. Skipping the gate until the
  // role has actually arrived fixes that: the user stays on the page they
  // refreshed, and the real role-gate still applies the moment it's known.
  const roleKnown = auth.actorType === "vendor" ? auth.vendor !== null : auth.user !== null;
  const view = pathname.replace(/^\//, "");
  if (roleKnown && ALL_STAFF_TAB_VIEWS.includes(view) && !(ROLE_TABS[auth.user?.role ?? ""] || []).includes(view)) {
    const fallback = auth.actorType === "vendor" ? "vendor-dashboard" : DEFAULT_VIEW_BY_ROLE[auth.user?.role ?? ""] || "dashboard";
    return <Navigate to={"/" + fallback} replace />;
  }

  return <AppShell />;
}
