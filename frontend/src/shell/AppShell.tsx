import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PageHead } from "./PageHead";
import { refreshChrome } from "../lib/chromeStore";

// Ported from index.html's static `<aside id="sidebar">` + `<main id="app">`
// shell -- the logged-in chrome every protected route renders inside.
// Sidebar badges and the header's fact strip come from the same real
// counts the dashboard itself shows (frontend/js/nav.js's refreshChrome(),
// which used to run at the end of every switchView() call; this effect
// used to be keyed on the route to match that "refresh on every
// navigation" behaviour exactly).
//
// Real bug, found 2026-10-15, user-reported via the browser's own network
// panel: browsing Dashboard -> Vendor List -> Mapping Matrix refetched the
// identical /dashboard/stats on every single click, for data that hadn't
// changed -- nothing about just LOOKING at a different page changes these
// counts. AppShell is the shared layout for every protected route (React
// Router doesn't remount it on a nested route change, only the <Outlet/>'s
// matched child), so it mounts once per session, not once per navigation
// -- dropping `pathname` from the dependency array below makes this run
// once on that mount instead of on every route change. Staying fresh
// after that relies on the pages that actually change one of these counts
// (approve a vendor, decide a mapping, ...) calling refreshChrome()
// themselves right after, which several already do (see chromeStore.ts's
// own comment) -- not on re-polling the same numbers on every click.
export function AppShell() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // Skipped when mounting straight onto /dashboard or /vendor-dashboard --
    // both DashboardPage.tsx and VendorDashboardPage.tsx fetch the same
    // data themselves and feed it straight into chromeStore
    // (applyDashboardStats / applyVendorPortalStats), so this would just be
    // the identical requests a second time (2026-10-28, user-reported: the
    // vendor half of this was never actually finished -- see
    // applyVendorPortalStats's own comment in chromeStore.ts).
    if (pathname !== "/dashboard" && pathname !== "/vendor-dashboard") refreshChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <main id="app">
        <Topbar onToggleMobile={() => setMobileOpen((o) => !o)} />
        <PageHead />
        <div className="ep-content" id="content">
          <Outlet />
        </div>
      </main>
    </>
  );
}
