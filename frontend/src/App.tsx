import { HashRouter, Routes, Route } from "react-router-dom";
import { NavigateSync } from "./lib/router";
import { AuthBoot } from "./shell/AuthBoot";
import { AuthLayout } from "./shell/AuthLayout";
import { ProtectedLayout } from "./shell/ProtectedLayout";
import { RootRedirect } from "./shell/RootRedirect";
// TopLoadingBar/LoadingBadge: unhooked for now (2026-10-15, user-directed),
// kept on disk, not deleted -- LoadingOverlay below is being tried in their
// place so the user can compare before deciding which one stays.
import { LoadingOverlay } from "./shell/LoadingOverlay";
import { StaffLoginPage } from "./pages/auth/StaffLoginPage";
import { VendorLoginPage } from "./pages/auth/VendorLoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { VendorListPage } from "./pages/vendors/VendorListPage";
import { VendorViewPage } from "./pages/vendors/VendorViewPage";
import { ProductListPage } from "./pages/catalog/ProductListPage";
import { AddProductPage } from "./pages/catalog/AddProductPage";
import { CategoryListPage } from "./pages/catalog/CategoryListPage";
import { SubCategoryListPage } from "./pages/catalog/SubCategoryListPage";
import { MappingMatrixPage } from "./pages/mappings/MappingMatrixPage";
import { MappingRequestsPage } from "./pages/mappings/MappingRequestsPage";
import { RatingsPage } from "./pages/ratings/RatingsPage";
import { VendorDashboardPage } from "./pages/vendor/VendorDashboardPage";
import { VendorProfilePage } from "./pages/vendor/VendorProfilePage";
import { VendorCategoriesPage } from "./pages/vendor/categories/VendorCategoriesPage";
import { TenderListPage } from "./pages/tenders/TenderListPage";
import { TenderEditorPage } from "./pages/tenders/TenderEditorPage";
import { ApprovalsPage } from "./pages/approvals/ApprovalsPage";
import { StaffAccountsPage } from "./pages/staff/StaffAccountsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { BidPage } from "./pages/bid/BidPage";
import { EvaluationPage } from "./pages/evaluation/EvaluationPage";
import { AwardsPage } from "./pages/awards/AwardsPage";
import { PoFilesPage } from "./pages/po/PoFilesPage";

// The real production app (Final Phase, 2026-10-12) -- replaces frontend/
// js/nav.js's switchView() dispatch table + index.html's static
// `<section id="view-X" hidden>` markup with a real route tree. Every one
// of the ~30 already-ported page components is unchanged; only how they
// get mounted moved from `mountX(container)` (a dynamic import into a
// specific root div) to a plain <Route element>. HashRouter, not
// BrowserRouter: backend/app/main.py serves frontend/ as plain
// StaticFiles(html=True) with no SPA catch-all fallback route, so a direct
// GET to e.g. /tenders would 404 -- a hash route never leaves `/` server-side,
// matching how the vanilla app already worked (no server round-trip for a
// view switch, just a different client-side state).
//
// No `key`-forced-remount wrapper on the route elements: React Router
// already remounts an element when the path changes to a different route
// (standard behaviour, same net effect as mounts.tsx's old remount-counter
// trick), and nothing in this app ever navigates from a route to that
// SAME route again (e.g. tender-edit -> tender-edit for a different
// pending id without visiting another route first) -- confirmed by reading
// every switchView()/setPendingXId() call site. If that assumption turns
// out wrong somewhere, the fix is a one-line `key={location.key}` on the
// affected <Route>'s element.
export function App() {
  return (
    <HashRouter>
      <LoadingOverlay />
      <NavigateSync />
      <AuthBoot />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<StaffLoginPage />} />
          <Route path="/vendor-login" element={<VendorLoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/queue" element={<VendorListPage />} />
          <Route path="/vendor-view" element={<VendorViewPage />} />
          <Route path="/catalog-list" element={<ProductListPage />} />
          <Route path="/catalog-add" element={<AddProductPage />} />
          <Route path="/catalog-categories" element={<CategoryListPage />} />
          <Route path="/catalog-subcategories" element={<SubCategoryListPage />} />
          <Route path="/mappings-matrix" element={<MappingMatrixPage />} />
          <Route path="/mappings-requests" element={<MappingRequestsPage />} />
          <Route path="/ratings" element={<RatingsPage />} />
          <Route path="/vendor-dashboard" element={<VendorDashboardPage />} />
          <Route path="/vendor-profile" element={<VendorProfilePage />} />
          <Route path="/vendor-categories" element={<VendorCategoriesPage />} />
          <Route path="/tenders" element={<TenderListPage />} />
          <Route path="/tender-edit" element={<TenderEditorPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/staff" element={<StaffAccountsPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="/bid" element={<BidPage />} />
          <Route path="/evaluation" element={<EvaluationPage />} />
          <Route path="/awards" element={<AwardsPage />} />
          <Route path="/pofiles" element={<PoFilesPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
