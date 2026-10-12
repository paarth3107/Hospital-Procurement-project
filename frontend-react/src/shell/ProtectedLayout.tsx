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

  const view = pathname.replace(/^\//, "");
  if (ALL_STAFF_TAB_VIEWS.includes(view) && !(ROLE_TABS[auth.user?.role ?? ""] || []).includes(view)) {
    const fallback = auth.actorType === "vendor" ? "vendor-dashboard" : DEFAULT_VIEW_BY_ROLE[auth.user?.role ?? ""] || "dashboard";
    return <Navigate to={"/" + fallback} replace />;
  }

  return <AppShell />;
}
