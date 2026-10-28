import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

// Real bug, found 2026-10-12: the three auth pages (staff-login/vendor-login/
// register) used to render inside index.html's static `<main id="app">` ->
// `<div class="ep-content" id="content">` -> `<section id="view-X" class="view
// auth-view [maxw-460px]">` structure -- once that markup became three bare
// `<Route path="/staff-login" element={<StaffLoginPage />} />` entries with
// nothing wrapping them, every bit of layout CSS keyed off that structure
// (styles.css's `.ep-content`/`.view` padding+gap+centering, and the
// width rules keyed off `:has(#sidebar:not([hidden]))` / `:has(#view-register
// :not([hidden]))`) stopped applying -- the form just rendered at full
// page width with no padding, no gap between its pieces, no centering.
// This replaces that structure exactly (same ids, same classes) as a layout
// route wrapping all three, rather than editing styles.css -- the CSS was
// already correct, it just had nothing to select.
//
// The MedSource branding block moved here (2026-10-22, user-directed) --
// it used to live inside StaffLoginPage.tsx alone (so VendorLoginPage never
// showed any branding at all). Shared chrome for the login flow specifically
// -- Register keeps its own look, same as before.
//
// Staff/Vendor tab switch REMOVED (2026-10-28, user-directed): staff and
// vendor login are now two fully separate pages (/staff-login, /vendor-login)
// with no shared toggle between them -- AuthTabs.tsx deleted, switchView()
// calls into "login"/"vendor-login" from either page removed along with it.
export interface AuthLayoutContext {
  setRegisterNarrow: (narrow: boolean) => void;
}

export function AuthLayout() {
  const { pathname } = useLocation();
  // The base route segment, not the full tail -- /reset-password/:token
  // carries a long opaque token after the second slash that has no business
  // being part of a CSS id.
  const view = pathname.replace(/^\//, "").split("/")[0];
  // Register wants the wider content area (styles.css's #view-register rule)
  // for its actual multi-column form -- but NOT for the "Registration
  // submitted" confirmation card RegisterPage swaps in once it's done (same
  // component, same route, just a different internal state). Real bug,
  // found 2026-10-24: that card set its own maxw-460px directly, but without
  // the SECTION also carrying auth-view.maxw-460px, styles.css's centering
  // rule (`.ep-content:has(.auth-view.maxw-460px)`) never matched, so the
  // card rendered at its default block position (top-left) instead of
  // centered like every other narrow auth card. RegisterPage reports which
  // mode it's in via registerNarrow (Outlet context) since this layout has
  // no other way to see that page's internal state.
  const [registerNarrow, setRegisterNarrow] = useState(false);
  useEffect(() => setRegisterNarrow(false), [view]); // always start wide on a fresh visit to /register
  const narrow = view !== "register" || registerNarrow;
  const isLoginFlow = view === "staff-login" || view === "vendor-login";
  // Forgot/Reset password (2026-10-23, user-directed: "the structure of the
  // new pages should be the same as the login pages"; extended to staff the
  // same day) get the same MedSource branding + centered card treatment as
  // login/vendor-login -- just without the Staff/Vendor AuthTabs switch,
  // which has no meaning mid-reset (which login page sent you here already
  // picked that).
  const isPasswordFlow = ["forgot-password", "reset-password", "staff-forgot-password", "staff-reset-password"].includes(view);
  return (
    <main id="app">
      <div className="ep-content" id="content">
        <section id={`view-${view}`} className={`view auth-view${narrow ? " maxw-460px" : ""}`}>
          {isLoginFlow || isPasswordFlow ? (
            <>
              <div className="auth-topblock">
                <div>
                  <div className="landing-title">MedSource</div>
                  <p className="hint mt-4px">Hospital E-Procurement Portal</p>
                </div>
              </div>
              {/* The card (heading + form + result + register link) centers on
                  the viewport on its own, independent of the topblock above --
                  user-directed, 2026-10-22: centering the whole stack as one
                  block put the card below true centre, pushed down by
                  whatever height the branding+tabs added above it. */}
              <div className="auth-card-center">
                <Outlet context={{ setRegisterNarrow }} />
              </div>
            </>
          ) : (
            <Outlet context={{ setRegisterNarrow }} />
          )}
        </section>
      </div>
    </main>
  );
}
