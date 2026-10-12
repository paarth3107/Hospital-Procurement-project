import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthState } from "./authStore";
import { ALL_STAFF_TAB_VIEWS, ROLE_TABS, DEFAULT_VIEW_BY_ROLE } from "./constants";

// Replaces frontend/js/nav.js's switchView() now that there's no more
// separate vanilla bundle for a `window.switchView` bridge to reach --
// every one of the ~30 already-ported pages just calls switchView(view)
// as a plain function (same call sites, unchanged), so this keeps that
// exact signature and routes it through React Router instead of toggling
// `.view[hidden]` sections. A plain function can't call the useNavigate()
// hook itself (hooks only work inside components), so <NavigateSync> below
// -- mounted once at the app's root -- captures the live navigate function
// into this module-level ref the moment the router exists.
let navigateRef: ((path: string, opts?: { replace?: boolean }) => void) | null = null;

export function NavigateSync() {
  const navigate = useNavigate();
  useEffect(() => {
    navigateRef = (path, opts) => navigate(path, opts);
    return () => {
      navigateRef = null;
    };
  }, [navigate]);
  return null;
}

// Same role-gate switchView() always had: a hidden tab is not enough --
// search results and deep links can still name any staff screen, so a role
// with no tab for it is sent to its own start page instead (the server
// refuses the data either way).
export function switchView(view: string) {
  const { actorType, user } = getAuthState();
  if (ALL_STAFF_TAB_VIEWS.includes(view) && !(ROLE_TABS[user?.role ?? ""] || []).includes(view)) {
    view = actorType === "vendor" ? "vendor-dashboard" : DEFAULT_VIEW_BY_ROLE[user?.role ?? ""] || "dashboard";
  }
  navigateRef?.("/" + view);
}
