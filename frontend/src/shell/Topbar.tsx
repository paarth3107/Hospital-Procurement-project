import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthState } from "../lib/authStore";
import { useChromeState } from "../lib/chromeStore";
import { identityFor, initials } from "./identity";
import { QuickSearch } from "./QuickSearch";
import { NotificationsMenu } from "./NotificationsMenu";
import { UserMenu } from "./UserMenu";
import { useTheme } from "./useTheme";

const SUN = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const MOON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

// Ported from index.html's static `<header id="appbar">` + frontend/js/
// shell.js's menu/dropdown wiring (dark-mode toggle, notifications,
// account menu, mobile hamburger).
export function Topbar({ onToggleMobile }: { onToggleMobile: () => void }) {
  const auth = useAuthState();
  const chrome = useChromeState();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<"notifications" | "user" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const identity = identityFor(auth);
  const isVendor = auth.actorType === "vendor";

  const hasNotifications = isVendor
    ? chrome.badgeVendorDashboard > 0
    : chrome.badgeQueue > 0 || chrome.badgeMappings > 0 || chrome.badgeApprovals > 0 || chrome.badgeAwards > 0 || chrome.badgeStaffNotifications > 0;

  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeydown);
    };
  }, [openMenu]);

  return (
    <header className="ep-appbar" id="appbar">
      <QuickSearch onNavigated={() => setOpenMenu(null)} />
      <button className="ep-icon-btn ep-menu-btn" type="button" aria-label="Open menu" aria-controls="sidebar" aria-expanded={false} onClick={onToggleMobile}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div className="ep-appbar-actions" ref={wrapRef}>
        <button className="ep-icon-btn" type="button" title="Toggle dark mode" aria-label="Toggle dark mode" onClick={toggleTheme}>
          {theme === "dark" ? SUN : MOON}
        </button>
        <div className="ep-dropdown-wrap">
          <button
            className="ep-icon-btn"
            type="button"
            title="Notifications"
            aria-label="Notifications"
            aria-expanded={openMenu === "notifications"}
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu((m) => (m === "notifications" ? null : "notifications"));
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {hasNotifications && <span className="ep-dot" />}
          </button>
          {openMenu === "notifications" && (
            <div onClick={(e) => e.stopPropagation()}>
              <NotificationsMenu onClose={() => setOpenMenu(null)} />
            </div>
          )}
        </div>
        <div className="ep-dropdown-wrap">
          <button
            className="ep-avatar"
            type="button"
            aria-expanded={openMenu === "user"}
            aria-label="Account menu"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu((m) => (m === "user" ? null : "user"));
            }}
          >
            {initials(identity.name)}
          </button>
          {openMenu === "user" && (
            <div onClick={(e) => e.stopPropagation()}>
              <UserMenu onClose={() => setOpenMenu(null)} onLoggedOut={() => navigate("/login")} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
