// Entry point. Each page module wires its own event listeners as a
// side effect of being imported; nav.js is the router that dispatches
// switchView() to the right page's load/render function. Importing every
// page module explicitly here (rather than relying on nav.js's own
// imports to pull them in transitively) keeps the dependency graph easy
// to read: this file is the one place that lists "every page that exists".
import "./nav.js";
import "./pages/registerPage.js";
import "./pages/staffLoginPage.js";
import "./pages/vendorLoginPage.js";
import "./pages/dashboardPage.js";
import "./pages/vendorQueuePage.js";
import "./pages/catalogPage.js";
import "./pages/mappingsPage.js";
import "./pages/ratingsPage.js";
import "./pages/tendersPage.js";
import "./pages/approvalsPage.js";
import "./pages/vendorDocumentsPage.js";
import "./pages/vendorProfilePage.js";
import "./pages/vendorCategoriesPage.js";
import "./pages/vendorDashboardPage.js";

import { api } from "./api.js";
import { state } from "./state.js";
import { switchView, showStaffTabsForRole, showVendorDashboardTab, DEFAULT_VIEW_BY_ROLE } from "./nav.js";
import { routeVendorAfterAuth } from "./pages/vendorLoginPage.js";

// ---- Restore session on load ----
(async function init() {
  if (!state.token) return;
  try {
    if (state.actorType === "vendor") {
      state.vendor = await api("/vendor-auth/me");
      document.getElementById("whoami").textContent = `${state.vendor.legal_name} — Vendor #${state.vendor.id}`;
      showVendorDashboardTab();
      await routeVendorAfterAuth();
    } else {
      state.user = await api("/auth/me");
      document.getElementById("whoami").textContent = `${state.user.full_name} — ${state.user.role}`;
      showStaffTabsForRole(state.user.role);
      switchView(DEFAULT_VIEW_BY_ROLE[state.user.role] || "tenders");
    }
  } catch (e) {
    state.token = null;
    state.actorType = null;
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("actorType");
  }
})();
