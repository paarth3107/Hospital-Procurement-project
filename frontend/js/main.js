// Entry point. Each page module wires its own event listeners as a
// side effect of being imported; nav.js is the router that dispatches
// switchView() to the right page's load/render function. Importing every
// page module explicitly here (rather than relying on nav.js's own
// imports to pull them in transitively) keeps the dependency graph easy
// to read: this file is the one place that lists "every page that exists".
import "./nav.js";
import "./pages/register/registerPage.js";
import "./pages/staffLoginPage.js";
import "./pages/vendorLoginPage.js";
import "./pages/dashboardPage.js";
import "./pages/vendorQueuePage.js";
import "./pages/catalog/catalogPage.js";
import "./pages/mappings/mappingsPage.js";
import "./pages/ratings/ratingsPage.js";
import "./pages/tenders/tendersPage.js";
import "./pages/approvalsPage.js";
import "./pages/vendorDocumentsPage.js";
import "./pages/vendorProfilePage.js";
import "./pages/vendorDashboardPage.js";

import { api } from "./api.js";
import { setWhoami } from "./ui.js";
import { staffRoleLabel } from "./kit.js";
import { state } from "./state.js";
import { switchView, showStaffTabsForRole, showVendorDashboardTab, DEFAULT_VIEW_BY_ROLE } from "./nav.js";
import { routeVendorAfterAuth } from "./pages/vendorLoginPage.js";
import { initShell } from "./shell.js";
import { showOpenLinkBanner } from "./pages/register/openLinkBanner.js";

initShell();

// ---- Restore session on load ----
(async function init() {
  // A registration link (?open=TOKEN) opens the vendor login screen with that
  // tender in the banner (2026-10-07: login first, not straight to
  // registration -- a vendor who already has an account just logs in; "New
  // vendor? Register here" carries the token into registerPage.js). Signed in
  // already -- vendor or staff -- the token has nothing left to do; fall
  // through to the normal session restore below instead of interrupting it.
  const openLinkToken = new URLSearchParams(location.search).get("open");
  if (openLinkToken) sessionStorage.setItem("openLinkToken", openLinkToken);
  if (openLinkToken && !state.token) {
    switchView("vendor-login");
    showOpenLinkBanner();
    return;
  }
  if (!state.token) return;
  try {
    if (state.actorType === "vendor") {
      state.vendor = await api("/vendor-auth/me");
      setWhoami(state.vendor.legal_name, `Vendor #${state.vendor.id}`, state.vendor.status === "active");
      showVendorDashboardTab();
      const deepLink = new URLSearchParams(location.search).get("view");
      if (deepLink && document.getElementById("view-" + deepLink)) switchView(deepLink);
      else await routeVendorAfterAuth();
    } else {
      state.user = await api("/auth/me");
      setWhoami(state.user.full_name, staffRoleLabel(state.user));
      showStaffTabsForRole(state.user.role);
      const deepLink = new URLSearchParams(location.search).get("view"); // e.g. /?view=mappings
      switchView(document.getElementById("view-" + deepLink) ? deepLink : DEFAULT_VIEW_BY_ROLE[state.user.role] || "tenders");
    }
  } catch (e) {
    state.token = null;
    state.actorType = null;
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("actorType");
  }
})();
