import { state } from "./state.js";
import { loadDashboard } from "./pages/dashboardPage.js";
import { loadVendors } from "./pages/vendorQueuePage.js";
import { loadProducts } from "./pages/catalogPage.js";
import { renderMappingMatrix, loadMappings } from "./pages/mappingsPage.js";
import { populateRatingPicker, renderRatingDashboard } from "./pages/ratingsPage.js";
import { loadVendorDashboard } from "./pages/vendorDashboardPage.js";
import { loadVendorProfile } from "./pages/vendorProfilePage.js";
import { loadTenders } from "./pages/tendersPage.js";
import { loadApprovals } from "./pages/approvalsPage.js";

export function switchView(view) {
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  document.getElementById("view-" + view).hidden = false;
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  if (view === "dashboard") loadDashboard();
  if (view === "queue") loadVendors();
  if (view === "catalog") loadProducts();
  if (view === "mappings") {
    renderMappingMatrix();
    loadMappings();
  }
  if (view === "ratings") {
    populateRatingPicker();
    renderRatingDashboard();
  }
  if (view === "vendor-dashboard") loadVendorDashboard();
  if (view === "vendor-profile") loadVendorProfile();
  if (view === "tenders") loadTenders();
  if (view === "approvals") loadApprovals();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// Which nav tabs are useful to each role, driven by what that role can
// actually do server-side (see backend/README.md's role tables) — not just
// "logged in staff sees everything". Kept in one place so a new tab only
// needs one line here, not a scattered set of if/role checks.
export const ROLE_TABS = {
  procurement_officer: ["dashboard", "tenders"],
  category_manager: ["dashboard", "queue", "catalog", "mappings", "ratings"],
  procurement_admin: ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "approvals"],
  approving_authority: ["dashboard", "approvals"],
  system_admin: ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "approvals"],
};
export const DEFAULT_VIEW_BY_ROLE = {
  procurement_officer: "dashboard",
  category_manager: "dashboard",
  procurement_admin: "dashboard",
  approving_authority: "dashboard",
  system_admin: "dashboard",
};
export const ALL_STAFF_TAB_VIEWS = ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "approvals"];

// Vendor Registration/Login and Staff Login are reached only through the
// landing page now (view-landing's two panels, plus a "back to home" link
// on each destination screen) -- no persistent nav tab for them anymore,
// so there's nothing to hide/show for the logged-out state here.

export function showStaffTabsForRole(role) {
  document.getElementById("topbar").hidden = false;
  document.getElementById("vendor-dashboard-tab").hidden = true;
  document.getElementById("vendor-profile-tab").hidden = true;
  document.getElementById("logout-btn").hidden = false;
  const allowed = new Set(ROLE_TABS[role] || []);
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = !allowed.has(view);
  }
  // Only Procurement Admin can save manual ratings server-side (see
  // ratings.py's require_role) — everyone else on the Ratings tab gets a
  // read-only lookup instead of a form that would just 403 on submit.
  document.getElementById("rating-update-form").hidden = role !== "procurement_admin";
}

export function showVendorDashboardTab() {
  document.getElementById("topbar").hidden = false;
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
  document.getElementById("vendor-dashboard-tab").hidden = false;
  document.getElementById("vendor-profile-tab").hidden = false;
  document.getElementById("logout-btn").hidden = false;
}

export function resetToLoggedOutNav() {
  document.getElementById("topbar").hidden = true;
  document.getElementById("vendor-dashboard-tab").hidden = true;
  document.getElementById("vendor-profile-tab").hidden = true;
  document.getElementById("logout-btn").hidden = true;
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
}

document.getElementById("logout-btn").addEventListener("click", () => {
  state.token = null;
  state.actorType = null;
  state.user = null;
  state.vendor = null;
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("actorType");
  document.getElementById("whoami").textContent = "";
  resetToLoggedOutNav();
  switchView("landing");
});

document.getElementById("brand-home-link").addEventListener("click", () => switchView("landing"));
document.querySelectorAll(".landing-btn, .back-home-link").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
