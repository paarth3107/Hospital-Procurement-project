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
// which used to run at the end of every switchView() call -- here it's an
// effect keyed on the route instead, same "refresh on every navigation"
// behaviour).
export function AppShell() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    refreshChrome();
  }, [pathname]);

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
