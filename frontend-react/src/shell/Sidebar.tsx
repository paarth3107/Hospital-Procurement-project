import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthState } from "../lib/authStore";
import { ROLE_TABS, DEFAULT_VIEW_BY_ROLE, NAV_TOP, NAV_VENDOR_TOP, NAV_GROUPS } from "../lib/constants";
import { NavGroup } from "./NavGroup";
import { NavItem } from "./NavItem";
import { useNavGroups } from "./useNavGroups";
import { useSidebarCollapse } from "./useSidebarCollapse";
import { identityFor } from "./identity";

// Ported from index.html's static `<aside id="sidebar">` + frontend/js/
// nav.js's showStaffTabsForRole()/showVendorDashboardTab()/
// resetToLoggedOutNav() + shell.js's collapse/peek handling -- all of which
// just reactively derive from the auth store and the current route here,
// instead of imperative DOM show/hide calls.
function currentView(pathname: string): string {
  return pathname.replace(/^\//, "") || "login";
}

// Sub-screens with no tab of their own highlight their parent tab instead.
function tabViewFor(view: string): string {
  if (view === "tender-edit") return "tenders";
  if (view === "vendor-view") return "queue";
  return view;
}

export function Sidebar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const auth = useAuthState();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { collapsed, peek, setPeek, toggle: toggleCollapsed } = useSidebarCollapse();
  const { saved: savedGroups, toggle: toggleGroup } = useNavGroups();
  const activeTabView = tabViewFor(currentView(pathname));
  const identity = identityFor(auth);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
  }, [collapsed]);

  const goHome = () => {
    if (!auth.token) {
      navigate("/login");
      return;
    }
    navigate(auth.actorType === "vendor" ? "/vendor-dashboard" : "/" + (DEFAULT_VIEW_BY_ROLE[auth.user?.role ?? ""] || "dashboard"));
  };

  const brand = (
    <div className="ep-brand" onClick={goHome} title="Back to home">
      <div className="ep-brand-mark">M</div>
      <div className="ep-brand-name">MedSource</div>
      <button
        type="button"
        className="ep-icon-btn sidebar-collapse-btn"
        title="Collapse sidebar"
        aria-label="Collapse sidebar"
        aria-expanded={!collapsed}
        onClick={(e) => {
          e.stopPropagation(); // sits inside the brand row, which also navigates home on click
          toggleCollapsed();
        }}
      >
        <svg className="collapse-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="15 6 9 12 15 18" />
        </svg>
      </button>
    </div>
  );

  if (!auth.token) {
    // Logged out: no persistent nav tab for any of the three auth screens.
    return null;
  }

  const isVendor = auth.actorType === "vendor";
  const items = isVendor ? NAV_VENDOR_TOP : NAV_TOP.filter((it) => (ROLE_TABS[auth.user?.role ?? ""] || []).includes(it.view));
  // A staff-only nav group is hidden entirely for a vendor, and shown for
  // staff only once at least one of its items is visible to this role --
  // same as vanilla's syncNavGroups() never leaving an empty heading.
  const groups = isVendor
    ? []
    : NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => (ROLE_TABS[auth.user?.role ?? ""] || []).includes(it.view)) })).filter((g) => g.items.length > 0);

  return (
    <aside
      className={`ep-side${mobileOpen ? " open" : ""}${peek ? " sidebar-peek" : ""}`}
      id="sidebar"
      onMouseEnter={() => setPeek(true)}
      onMouseLeave={() => setPeek(false)}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest(".tab-btn")) onCloseMobile();
      }}
    >
      {brand}
      <div className="ep-navhead">{isVendor ? "Vendor portal" : "Procurement workspace"}</div>
      <nav className="ep-navlist">
        {items.map((it) => (
          <NavItem item={it} active={activeTabView === it.view} key={it.view} />
        ))}
        {groups.map((g) => (
          <NavGroup
            groupKey={g.key}
            label={g.label}
            icon={g.icon}
            collapsed={!!savedGroups[g.key] && !g.items.some((it) => it.view === activeTabView)}
            onToggleCollapsed={() => toggleGroup(g.key)}
            key={g.key}
          >
            {g.items.map((it) => (
              <NavItem item={it} active={activeTabView === it.view} key={it.view} />
            ))}
          </NavGroup>
        ))}
      </nav>
      <div className="ep-identity">
        {identity.name && (
          <div id="whoami">
            <div className="who-name">
              {identity.name} {identity.verified && <span className="verified-tick" title="Active, approved vendor">✓</span>}
            </div>
            <div className="who-role">{identity.role}</div>
          </div>
        )}
      </div>
    </aside>
  );
}
