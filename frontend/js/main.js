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
import { state } from "./state.js";
import { switchView, showStaffTabsForRole, showVendorDashboardTab, DEFAULT_VIEW_BY_ROLE } from "./nav.js";
import { routeVendorAfterAuth } from "./pages/vendorLoginPage.js";

// ---- Restore session on load ----
(async function init() {
  if (!state.token) return;
  try {
    if (state.actorType === "vendor") {
      state.vendor = await api("/vendor-auth/me");
      setWhoami(state.vendor.legal_name, `Vendor #${state.vendor.id}`);
      showVendorDashboardTab();
      const deepLink = new URLSearchParams(location.search).get("view");
      if (deepLink && document.getElementById("view-" + deepLink)) switchView(deepLink);
      else await routeVendorAfterAuth();
    } else {
      state.user = await api("/auth/me");
      setWhoami(state.user.full_name, state.user.role.replace(/_/g, " "));
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
