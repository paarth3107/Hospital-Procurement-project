import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthState } from "../lib/authStore";
import { useChromeState } from "../lib/chromeStore";
import { ROLE_TABS, DEFAULT_VIEW_BY_ROLE, BADGE_FIELD, NAV_TOP, NAV_VENDOR_TOP, NAV_GROUPS } from "../lib/constants";
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
// Real bug, found 2026-10-23: this used to take the FULL pathname (e.g.
// "tender-edit/5"), so any :id-suffixed route only ever matched a nav item
// by exact string equality -- which an id suffix always breaks. Harmless
// while nothing was ":id"-shaped, but every route this session converted
// to a real `:id` route (approvals/:id, awards/:id, vendor-view/:id, and
// now tender-edit/:id) silently stopped highlighting anything the moment
// a specific record was open. First path segment only, so a detail/edit
// view still resolves to its own list tab generically, without a growing
// per-view special case for every such route.
function currentView(pathname: string): string {
  return pathname.replace(/^\//, "").split("/")[0] || "login";
}

// Sub-screens that highlight a DIFFERENT tab than their own first path
// segment would otherwise resolve to. `hasIdSuffix` distinguishes bare
// /tender-edit (creating a new tender -- now its own "Create Tender" tab)
// from /tender-edit/:id (editing an existing one -- highlights the list
// it came from instead).
function tabViewFor(view: string, hasIdSuffix: boolean): string {
  if (view === "tender-edit" && hasIdSuffix) return "tenders";
  if (view === "vendor-view") return "queue";
  return view;
}

export function Sidebar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const auth = useAuthState();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { collapsed, peek, setPeek, toggle: toggleCollapsed } = useSidebarCollapse();
  const { toggle: toggleGroup, isCollapsed: isGroupCollapsed } = useNavGroups();
  const chrome = useChromeState();
  const hasIdSuffix = pathname.replace(/^\//, "").split("/").filter(Boolean).length > 1;
  const activeTabView = tabViewFor(currentView(pathname), hasIdSuffix);
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
        {groups.map((g) => {
          // A group containing the page you're currently on always renders
          // expanded (below), regardless of its saved collapsed state --
          // but the click handler must agree, not just the render. Real bug,
          // found 2026-10-26: toggling while inside used to flip the SAVED
          // state anyway (it just had no visible effect, overridden the same
          // way below), so the collapse appeared to fire later, the moment
          // you navigated to a different group's page instead of the one
          // you actually clicked collapse on. Ignoring the click outright
          // while inside -- not just overriding its visible effect -- means
          // there's nothing left pending to surprise you with on your way out.
          const containsActive = g.items.some((it) => it.view === activeTabView);
          return (
            <NavGroup
              groupKey={g.key}
              label={g.label}
              icon={g.icon}
              collapsed={isGroupCollapsed(g.key) && !containsActive}
              badgeTotal={g.items.reduce((sum, it) => sum + (it.badge ? chrome[BADGE_FIELD[it.badge]] : 0), 0)}
              onToggleCollapsed={() => {
                if (!containsActive) toggleGroup(g.key);
              }}
              key={g.key}
            >
              {g.items.map((it) => (
                <NavItem item={it} active={activeTabView === it.view} key={it.view} />
              ))}
            </NavGroup>
          );
        })}
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
