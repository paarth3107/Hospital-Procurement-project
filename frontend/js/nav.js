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
import { loadVendorCategoriesTab } from "./pages/vendorCategories/vendorCategoriesPage.js";
import { loadTenders } from "./pages/tenders/tendersPage.js";
import { loadApprovals } from "./pages/approvalsPage.js";
import { loadStaff } from "./pages/staff/staffPage.js";
import { loadAuditLog } from "./pages/audit/auditPage.js";
import { loadBid } from "./pages/bid/bidPage.js";
import { loadEvaluation } from "./pages/evaluation/evaluationPage.js";
import { loadAwards } from "./pages/awards/awardsPage.js";
import { loadPoFiles } from "./pages/po/poFilesPage.js";

// Page header (kicker + title) per screen, as in the prototype.
const PAGE_TITLES = {
  dashboard: ["Overview", "Procurement Command Centre"],
  queue: ["Module 1", "Vendor Registration & Onboarding"],
  catalog: ["Module 2", "Items"],
  mappings: ["Module 2", "Vendor–Product Eligibility Matrix"],
  ratings: ["Module 3", "Vendor Rating & Scorecard"],
  tenders: ["Module 4", "E-Tender Creation"],
  "tender-edit": ["Module 4", "E-Tender Creation"],
  approvals: ["Module 4B", "E-Tender Approval"],
  staff: ["Administration", "Staff Accounts"],
  audit: ["Administration", "Audit Log"],
  bid: ["Vendor Portal", "Prepare Bid"],
  evaluation: ["Module 6", "Bid Evaluation"],
  awards: ["Module 6-7", "L1 Recommendation & Approval"],
  pofiles: ["Module 7", "PO Data Files For The ERP"],
  "vendor-dashboard": ["Vendor Portal", "Dashboard"],
  "vendor-profile": ["Module 1", "Company Profile & Documents"],
  "vendor-categories": ["Module 1", "Category Declaration"],
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
      const notes = await api("/vendor-portal/notifications");
      badge("badge-vendor-dashboard", notes.filter((n) => !n.read).length);
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
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  document.getElementById("view-" + view).hidden = false;
  setPageHead(view);
  refreshChrome();
  const tabView = view === "tender-edit" ? "tenders" : view; // the editor is a sub-screen of Tenders, not its own tab
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.view === tabView;
    btn.classList.toggle("active", active);
    if (active) btn.closest(".ep-navgroup")?.classList.remove("collapsed");
  });
  if (view === "dashboard") loadDashboard();
  if (view === "queue") loadVendors();
  if (view === "catalog") loadProducts();
  if (view === "mappings") loadMappingsPage();
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

document.querySelectorAll(".back-link").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// Which nav tabs are useful to each role, driven by what that role can
// actually do server-side (see backend/README.md's role tables) — not just
// "logged in staff sees everything". Kept in one place so a new tab only
// needs one line here, not a scattered set of if/role checks.
export const ROLE_TABS = {
  procurement_officer: ["dashboard", "tenders", "evaluation", "awards"],
  // Procurement Admin and Category Manager are one job (KYC, mapping, catalog, ratings).
  category_manager: ["dashboard", "queue", "catalog", "mappings", "ratings", "evaluation", "pofiles"],
  procurement_admin: ["dashboard", "queue", "catalog", "mappings", "ratings", "evaluation", "pofiles"],
  approving_authority: ["dashboard", "approvals", "awards"],
  system_admin: ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "evaluation", "awards", "pofiles", "approvals", "staff", "audit"],
};
export const DEFAULT_VIEW_BY_ROLE = {
  procurement_officer: "dashboard",
  category_manager: "dashboard",
  procurement_admin: "dashboard",
  approving_authority: "dashboard",
  system_admin: "dashboard",
};
export const ALL_STAFF_TAB_VIEWS = ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "evaluation", "awards", "pofiles", "approvals", "staff", "audit"];

// Vendor Registration/Login and Staff Login are reached only through the
// landing page now (view-landing's two panels, plus a "back to home" link
// on each destination screen) -- no persistent nav tab for them anymore,
// so there's nothing to hide/show for the logged-out state here.

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
  document.getElementById("search-box").hidden = true;
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
  switchView("landing");
});

document.getElementById("brand-home-link").addEventListener("click", () => switchView("landing"));
document.querySelectorAll(".landing-btn, .back-home-link").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
