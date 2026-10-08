import { state } from "./state.js";
import { setWhoami } from "./ui.js";
import { api } from "./api.js";
import { esc, fmtDateTime } from "./kit.js";
import { loadDashboard } from "./pages/dashboardPage.js";
import { loadVendors } from "./pages/vendorListPage.js";
import { loadVendorView } from "./pages/vendorViewPage.js";
import { loadList as loadCatalogList } from "./pages/catalog/productListPage.js";
import { loadAddProduct as loadCatalogAdd } from "./pages/catalog/addProductPage.js";
import { loadCategories as loadCatalogCategories } from "./pages/catalog/categoryListPage.js";
import { loadSubCategories as loadCatalogSubcategories } from "./pages/catalog/subCategoryListPage.js";
import { loadMappingMatrix } from "./pages/mappings/mappingMatrixPage.js";
import { loadMappingRequests } from "./pages/mappings/mappingRequestsPage.js";
import { loadRatingsPage } from "./pages/ratings/ratingsPage.js";
import { loadVendorDashboard } from "./pages/vendorDashboardPage.js";
import { loadVendorProfile } from "./pages/vendorProfilePage.js";
import { loadVendorCategoriesTab } from "./pages/vendorCategories/vendorCategoriesPage.js";
import { loadTenders } from "./pages/tenders/tendersPage.js";
import { loadApprovals } from "./pages/approvalsPage.js";
import { loadStaff } from "./pages/staff/staffPage.js";
import { loadAuditLog } from "./pages/audit/auditPage.js";
import { loadBid } from "./pages/bid/bidPage.js";
import { loadEvaluation } from "./pages/evaluation/evaluationPage.js";
import { loadAwards } from "./pages/awards/awardsPage.js";
import { loadPoFiles } from "./pages/po/poFilesPage.js";
import { closingSoonTenders } from "./pages/vendorNotifications.js";

// Page header (kicker + title) per screen, as in the prototype. The "Module
// N" kickers were dropped (2026-10-08) -- an internal spec-section label
// that meant nothing to the person using the screen; #page-kicker collapses
// to nothing when empty (styles.css), so these are just [, title] now.
const PAGE_TITLES = {
  dashboard: ["Overview", "Dashboard"],
  queue: ["", "Vendor List"],
  "vendor-view": ["", "Vendor Profile"],
  "catalog-list": ["", "Product List"],
  "catalog-add": ["", "Add Product"],
  "catalog-categories": ["", "Category List"],
  "catalog-subcategories": ["", "Sub-Category List"],
  "mappings-matrix": ["", "Mapping Matrix"],
  "mappings-requests": ["", "Mapping Requests"],
  ratings: ["", "Vendor Rating & Scorecard"],
  tenders: ["", "E-Tender Creation"],
  "tender-edit": ["", "E-Tender Creation"],
  approvals: ["", "E-Tender Approval"],
  staff: ["Administration", "Staff Accounts"],
  audit: ["Administration", "Audit Log"],
  bid: ["Vendor Portal", "Prepare Bid"],
  evaluation: ["", "Bid Evaluation"],
  awards: ["", "L1 Recommendation & Approval"],
  pofiles: ["", "PO Data Files For The ERP"],
  "vendor-dashboard": ["Vendor Portal", "Dashboard"],
  "vendor-profile": ["", "Company Profile & Documents"],
  "vendor-categories": ["", "Category Declaration"],
};

function setPageHead(view) {
  const head = document.getElementById("page-head");
  const titles = PAGE_TITLES[view];
  head.hidden = !titles || document.getElementById("sidebar").hidden;
  if (!titles) return;
  document.getElementById("page-kicker").textContent = titles[0];
  document.getElementById("page-title").textContent = titles[1];
}

// Sidebar badges and the header's fact strip come from the same real counts
// as the dashboard (staff only).
export async function refreshChrome() {
  if (!state.token) return;
  const badge = (id, n) => (document.getElementById(id).textContent = n ? String(n) : "");
  if (state.actorType === "vendor") {
    // items whose catalog entry asks for documents the vendor still owes
    try {
      const reqs = await api("/vendor-portal/documents/requirements");
      badge("badge-vendor-categories", reqs.filter((r) => r.summary === "documents_needed").length);
      // Unread notifications plus tenders closing within 24 hours (the
      // latter has no "read" state -- it's just currently true or not) --
      // one combined count, same thing the top bell shows (shell.js).
      const [notes, tenders] = await Promise.all([api("/vendor-portal/notifications"), api("/vendor-portal/tenders")]);
      badge("badge-vendor-dashboard", notes.filter((n) => !n.read).length + closingSoonTenders(tenders).length);
    } catch (err) {
      // decorative
    }
    return;
  }
  try {
    const s = await api("/dashboard/stats");
    badge("badge-queue", s.vendors_pending_count + s.docs_to_verify.length);
    badge("badge-awards", s.award_tasks.length);
    badge("badge-approvals", s.pending_approval_count);
    badge("badge-mappings", s.mappings_pending_count);
    document.getElementById("page-facts").innerHTML = `
      <div class="ep-fact"><div class="ep-k">Open tenders</div><div class="ep-fact-value">${esc(s.open_tenders_count)}</div></div>
      <div class="ep-fact-rule"></div>
      <div class="ep-fact"><div class="ep-k">Next bid close</div><div class="ep-fact-value text-primary-deep">${s.next_bid_close ? esc(fmtDateTime(s.next_bid_close)) : "—"}</div></div>`;
  } catch (err) {
    // chrome is decorative; a failed refresh must never block the screen
  }
}

export function switchView(view) {
  // Hiding a tab is not enough: search results and ?view= links can still name
  // any staff screen. Send a role (or a vendor) that has no tab for it to its
  // own start page instead. The server refuses the data either way.
  if (ALL_STAFF_TAB_VIEWS.includes(view) && !(ROLE_TABS[state.user?.role] || []).includes(view)) {
    view = state.actorType === "vendor" ? "vendor-dashboard" : DEFAULT_VIEW_BY_ROLE[state.user?.role] || "dashboard";
  }
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  document.getElementById("view-" + view).hidden = false;
  setPageHead(view);
  refreshChrome();
  // Sub-screens with no tab of their own highlight their parent tab instead.
  const tabView = view === "tender-edit" ? "tenders" : view === "vendor-view" ? "queue" : view;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.view === tabView;
    btn.classList.toggle("active", active);
    if (active) {
      const group = btn.closest(".ep-navgroup");
      group?.classList.remove("collapsed");
      // Clear the inline max-height shell.js's slide animation pins on
      // collapse -- just dropping the class isn't enough to re-reveal it now
      // that this is a height transition rather than a display:none toggle.
      const items = group?.querySelector(".ep-navgroup-items");
      if (items) items.style.maxHeight = "";
    }
  });
  if (view === "dashboard") loadDashboard();
  if (view === "queue") loadVendors();
  if (view === "vendor-view") loadVendorView();
  if (view === "catalog-list") loadCatalogList();
  if (view === "catalog-add") loadCatalogAdd();
  if (view === "catalog-categories") loadCatalogCategories();
  if (view === "catalog-subcategories") loadCatalogSubcategories();
  if (view === "mappings-matrix") loadMappingMatrix();
  if (view === "mappings-requests") loadMappingRequests();
  if (view === "ratings") loadRatingsPage();
  if (view === "vendor-dashboard") loadVendorDashboard();
  if (view === "vendor-profile") loadVendorProfile();
  if (view === "vendor-categories") loadVendorCategoriesTab();
  if (view === "tenders") loadTenders();
  if (view === "approvals") loadApprovals();
  if (view === "staff") loadStaff();
  if (view === "audit") loadAuditLog();
  if (view === "bid") loadBid();
  if (view === "evaluation") loadEvaluation();
  if (view === "awards") loadAwards();
  if (view === "pofiles") loadPoFiles();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// Also wires the small forward links between the three auth screens (staff
// login <-> vendor login -> register) -- same plain-text-button look, same
// "go to this view" behavior as a back-link.
document.querySelectorAll(".back-link, .link-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// Which nav tabs are useful to each role, driven by what that role can
// actually do server-side (see backend/README.md's role tables) — not just
// "logged in staff sees everything". Kept in one place so a new tab only
// needs one line here, not a scattered set of if/role checks.
const CATALOG_VIEWS = ["catalog-list", "catalog-add", "catalog-categories", "catalog-subcategories"];
const MAPPING_VIEWS = ["mappings-matrix", "mappings-requests"];
export const ROLE_TABS = {
  procurement_officer: ["dashboard", "tenders", "evaluation", "awards"],
  // Procurement Admin and Category Manager are one job (KYC, mapping, catalog, ratings).
  category_manager: ["dashboard", "queue", ...CATALOG_VIEWS, ...MAPPING_VIEWS, "ratings", "evaluation", "pofiles"],
  procurement_admin: ["dashboard", "queue", ...CATALOG_VIEWS, ...MAPPING_VIEWS, "ratings", "evaluation", "pofiles"],
  approving_authority: ["dashboard", "approvals", "awards"],
  system_admin: ["dashboard", "queue", ...CATALOG_VIEWS, ...MAPPING_VIEWS, "ratings", "tenders", "evaluation", "awards", "pofiles", "approvals", "staff", "audit"],
};
export const DEFAULT_VIEW_BY_ROLE = {
  procurement_officer: "dashboard",
  category_manager: "dashboard",
  procurement_admin: "dashboard",
  approving_authority: "dashboard",
  system_admin: "dashboard",
};
export const ALL_STAFF_TAB_VIEWS = ["dashboard", "queue", ...CATALOG_VIEWS, ...MAPPING_VIEWS, "ratings", "tenders", "evaluation", "awards", "pofiles", "approvals", "staff", "audit"];

// Staff login is the default entry screen (2026-10-07); Vendor login and
// Registration are one click away from it (and from each other), each with
// a link back -- no persistent nav tab for any of the three, so there's
// nothing to hide/show for the logged-out state here.

export function showStaffTabsForRole(role) {
  document.getElementById("sidebar").hidden = false;
  document.getElementById("nav-heading").textContent = "Procurement workspace";
  document.getElementById("page-facts").innerHTML = "";
  document.getElementById("vendor-dashboard-tab").hidden = true;
  document.getElementById("vendor-profile-tab").hidden = true;
  document.getElementById("vendor-categories-tab").hidden = true;
  document.getElementById("logout-btn").hidden = false;
  const allowed = new Set(ROLE_TABS[role] || []);
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = !allowed.has(view);
  }
  document.getElementById("search-box").hidden = false;
  document.getElementById("search-input").placeholder = "Search vendors, tenders, items";
  syncNavGroups();
  // Only Procurement Admin can save manual ratings server-side (see
  // ratings.py's require_role) — everyone else on the Ratings tab gets a
  // read-only lookup instead of a form that would just 403 on submit.
}

export function showVendorDashboardTab() {
  document.getElementById("sidebar").hidden = false;
  document.getElementById("nav-heading").textContent = "Vendor portal";
  document.getElementById("page-facts").innerHTML = "";
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
  document.getElementById("vendor-dashboard-tab").hidden = false;
  document.getElementById("vendor-profile-tab").hidden = false;
  document.getElementById("vendor-categories-tab").hidden = false;
  document.getElementById("logout-btn").hidden = false;
  // Vendors get their own scoped quick search (their invited tenders and the
  // items on them, GET /vendor-portal/search) -- not the staff-wide one,
  // which a vendor token is refused on. See shell.js's onSearchInput.
  document.getElementById("search-box").hidden = false;
  document.getElementById("search-input").placeholder = "Search your tenders and items";
  syncNavGroups();
}

export function resetToLoggedOutNav() {
  document.getElementById("sidebar").hidden = true;
  document.getElementById("vendor-dashboard-tab").hidden = true;
  document.getElementById("vendor-profile-tab").hidden = true;
  document.getElementById("vendor-categories-tab").hidden = true;
  document.getElementById("logout-btn").hidden = true;
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
  syncNavGroups();
}

// A sidebar group is shown only while at least one of its pages is visible to
// this role, so a Staff-only group never shows as an empty heading for a Vendor.
function syncNavGroups() {
  document.querySelectorAll(".ep-navgroup").forEach((group) => {
    const anyVisible = [...group.querySelectorAll(".tab-btn")].some((btn) => !btn.hidden);
    group.hidden = !anyVisible;
  });
}

document.getElementById("logout-btn").addEventListener("click", () => {
  state.token = null;
  state.actorType = null;
  state.user = null;
  state.vendor = null;
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("actorType");
  setWhoami("", "");
  resetToLoggedOutNav();
  switchView("login");
});

// Logged in, the brand goes to that session's own dashboard (staff or
// vendor) rather than the login screen -- logged out, there's no separate
// chooser page to go "home" to, so it's the login screen itself.
document.getElementById("brand-home-link").addEventListener("click", () => {
  if (!state.token) return switchView("login");
  switchView(state.actorType === "vendor" ? "vendor-dashboard" : DEFAULT_VIEW_BY_ROLE[state.user?.role] || "dashboard");
});
