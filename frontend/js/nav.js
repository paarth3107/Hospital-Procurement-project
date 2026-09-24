import { state } from "./state.js";
import { setWhoami } from "./ui.js";
import { api } from "./api.js";
import { esc, fmtDateTime } from "./kit.js";
import { loadDashboard } from "./pages/dashboardPage.js";
import { loadVendors } from "./pages/vendorQueuePage.js";
import { loadProducts } from "./pages/catalog/catalogPage.js";
import { loadMappingsPage } from "./pages/mappings/mappingsPage.js";
import { loadRatingsPage } from "./pages/ratings/ratingsPage.js";
import { loadVendorDashboard } from "./pages/vendorDashboardPage.js";
import { loadVendorProfile } from "./pages/vendorProfilePage.js";
import { loadTenders } from "./pages/tenders/tendersPage.js";
import { loadApprovals } from "./pages/approvalsPage.js";

// Page header (kicker + title) per screen, as in the prototype.
const PAGE_TITLES = {
  dashboard: ["Overview", "Procurement command centre"],
  queue: ["Module 1", "Vendor registration & onboarding"],
  catalog: ["Module 2", "Items"],
  mappings: ["Module 2", "Vendor–product eligibility matrix"],
  ratings: ["Module 3", "Vendor rating & scorecard"],
  tenders: ["Module 4", "E-tender creation"],
  approvals: ["Module 4B", "E-tender approval"],
  "vendor-dashboard": ["Vendor portal", "Tender invitations"],
  "vendor-profile": ["Module 1", "Company profile & documents"],
};

function setPageHead(view) {
  const head = document.getElementById("page-head");
  const titles = PAGE_TITLES[view];
  head.hidden = !titles || document.getElementById("topbar").hidden;
  if (!titles) return;
  document.getElementById("page-kicker").textContent = titles[0];
  document.getElementById("page-title").textContent = titles[1];
}

// Sidebar badges and the header's fact strip come from the same real counts
// as the dashboard (staff only).
export async function refreshChrome() {
  if (state.actorType === "vendor" || !state.token) return;
  try {
    const s = await api("/dashboard/stats");
    const badge = (id, n) => (document.getElementById(id).textContent = n ? String(n) : "");
    badge("badge-queue", s.vendors_pending_count);
    badge("badge-approvals", s.pending_approval_count);
    badge("badge-mappings", s.mappings_pending_count);
    document.getElementById("page-facts").innerHTML = `
      <div class="ep-fact"><div class="ep-k">Open tenders</div><div class="ep-fact-value">${esc(s.open_tenders_count)}</div></div>
      <div class="ep-fact-rule"></div>
      <div class="ep-fact"><div class="ep-k">Next bid close</div><div class="ep-fact-value" style="color:#ae1800">${s.next_bid_close ? esc(fmtDateTime(s.next_bid_close)) : "—"}</div></div>`;
  } catch (err) {
    // chrome is decorative; a failed refresh must never block the screen
  }
}

export function switchView(view) {
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  document.getElementById("view-" + view).hidden = false;
  setPageHead(view);
  refreshChrome();
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  if (view === "dashboard") loadDashboard();
  if (view === "queue") loadVendors();
  if (view === "catalog") loadProducts();
  if (view === "mappings") loadMappingsPage();
  if (view === "ratings") loadRatingsPage();
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
  procurement_officer: ["dashboard", "queue", "tenders"],
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
  document.getElementById("nav-heading").textContent = "Procurement workspace";
  document.getElementById("page-facts").innerHTML = "";
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
}

export function showVendorDashboardTab() {
  document.getElementById("topbar").hidden = false;
  document.getElementById("nav-heading").textContent = "Vendor portal";
  document.getElementById("page-facts").innerHTML = "";
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
  setWhoami("", "");
  resetToLoggedOutNav();
  switchView("landing");
});

document.getElementById("brand-home-link").addEventListener("click", () => switchView("landing"));
document.querySelectorAll(".landing-btn, .back-home-link").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
