import { Outlet, useLocation } from "react-router-dom";
import { AuthTabs } from "../pages/auth/AuthTabs";

// Real bug, found 2026-10-12: the three auth pages (login/vendor-login/
// register) used to render inside index.html's static `<main id="app">` ->
// `<div class="ep-content" id="content">` -> `<section id="view-X" class="view
// auth-view [maxw-460px]">` structure -- once that markup became three bare
// `<Route path="/login" element={<StaffLoginPage />} />` entries with
// nothing wrapping them, every bit of layout CSS keyed off that structure
// (styles.css's `.ep-content`/`.view` padding+gap+centering, and the
// width rules keyed off `:has(#sidebar:not([hidden]))` / `:has(#view-register
// :not([hidden]))`) stopped applying -- the form just rendered at full
// page width with no padding, no gap between its pieces, no centering.
// This replaces that structure exactly (same ids, same classes) as a layout
// route wrapping all three, rather than editing styles.css -- the CSS was
// already correct, it just had nothing to select.
//
// The MedSource branding block and the Staff/Vendor tab switch both moved
// here (2026-10-22, user-directed) -- they used to live inside
// StaffLoginPage.tsx alone (so VendorLoginPage never showed any branding at
// all, and switching between the two was an asymmetric pair of links: a
// "Supplier? Click here" at the bottom of Staff login, a "← Back to staff
// login" at the top of Vendor login). Both are shared chrome for the login
// flow specifically -- Register keeps its own look, no tabs, same as before.
export function AuthLayout() {
  const { pathname } = useLocation();
  const view = pathname.replace(/^\//, "");
  // Register wants the wider content area (styles.css's #view-register rule);
  // login/vendor-login keep the compact centered box.
  const narrow = view !== "register";
  const isLoginFlow = view === "login" || view === "vendor-login";
  return (
    <main id="app">
      <div className="ep-content" id="content">
        <section id={`view-${view}`} className={`view auth-view${narrow ? " maxw-460px" : ""}`}>
          {isLoginFlow ? (
            <>
              <div className="auth-topblock">
                <div>
                  <div className="landing-title">MedSource</div>
                  <p className="hint mt-4px">Hospital E-Procurement Portal</p>
                </div>
                <AuthTabs active={view as "login" | "vendor-login"} />
              </div>
              {/* The card (heading + form + result + register link) centers on
                  the viewport on its own, independent of the topblock above --
                  user-directed, 2026-10-22: centering the whole stack as one
                  block put the card below true centre, pushed down by
                  whatever height the branding+tabs added above it. */}
              <div className="auth-card-center">
                <Outlet />
              </div>
            </>
          ) : (
            <Outlet />
          )}
        </section>
      </div>
    </main>
  );
}
