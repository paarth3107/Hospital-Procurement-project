import { Outlet, useLocation } from "react-router-dom";

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
export function AuthLayout() {
  const { pathname } = useLocation();
  const view = pathname.replace(/^\//, "");
  // Register wants the wider content area (styles.css's #view-register rule);
  // login/vendor-login keep the compact centered box.
  const narrow = view !== "register";
  return (
    <main id="app">
      <div className="ep-content" id="content">
        <section id={`view-${view}`} className={`view auth-view${narrow ? " maxw-460px" : ""}`}>
          <Outlet />
        </section>
      </div>
    </main>
  );
}
