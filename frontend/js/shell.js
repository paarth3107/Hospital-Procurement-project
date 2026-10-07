import { api } from "./api.js";
import { state } from "./state.js";
import { esc } from "./kit.js";
import { switchView, refreshChrome } from "./nav.js";
import { hydrateIcons } from "./icons.js";
import { refreshCharts } from "./charts.js";
import { openTenderBid } from "./pages/bid/bidPage.js";
import { bellRowsHtml, wireBellRows } from "./pages/vendorNotifications.js";

// Top navbar behaviour: dark-mode toggle, quick search, notifications and the
// account menu, plus collapsing the grouped sidebar. Each control reads the
// same counts the sidebar badges already show, so there is no second source.

const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

// Badge id -> what it means, and the view that resolves it.
const NOTIFICATIONS = [
  ["badge-queue", "Vendor registrations to review", "queue"],
  ["badge-mappings", "Mapping requests waiting", "mappings"],
  ["badge-approvals", "Tender approvals waiting", "approvals"],
  ["badge-awards", "Award tasks", "awards"],
  ["badge-vendor-categories", "Documents still needed", "vendor-categories"],
  ["badge-vendor-dashboard", "Unread notifications", "vendor-dashboard"],
];

// Staff groups switch to the matching tab (same item can be found again
// there); a vendor has no such tabs for its results, so a null view means
// "open that tender's bid page directly" (see renderSearchResults) instead.
const SEARCH_GROUPS = {
  staff: [
    ["vendors", "Vendors", "queue"],
    ["tenders", "Tenders", "tenders"],
    ["products", "Items", "catalog-list"],
  ],
  vendor: [
    ["tenders", "Your tenders", null],
    ["products", "Items on your tenders", null],
  ],
};
const searchEndpoint = () => (state.actorType === "vendor" ? "/vendor-portal/search" : "/search");

const $ = (id) => document.getElementById(id);

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // private mode or blocked storage: the choice just won't persist
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme-toggle").innerHTML = theme === "dark" ? SUN : MOON;
  refreshCharts();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  writeStored("theme", next);
  applyTheme(next);
}

function notificationRows() {
  return NOTIFICATIONS.map(([badgeId, label, view]) => ({ n: $(badgeId)?.textContent || "", label, view })).filter((r) => r.n);
}

// Staff keep the existing badge-derived summary (one row per queue, with a
// count -- opening it just jumps to that list). A vendor gets the real
// content instead (2026-10-07): its actual notifications plus tenders
// closing soon, read live off the API each time the bell opens, the same
// way the dashboard's own notification pane and closing-soon banner do.
// The dot itself stays driven by the sidebar badges either way (the
// MutationObserver below) -- badge-vendor-dashboard already carries the
// vendor's combined unread-notifications + closing-soon count (nav.js).
async function renderNotifications() {
  $("notifications-dot").hidden = notificationRows().length === 0;
  const box = $("notifications-menu");
  if (state.actorType === "vendor") {
    box.innerHTML = `<div class="ep-dropdown-head">Notifications</div><div class="ep-dropdown-empty">Loading…</div>`;
    try {
      const [notes, tenders] = await Promise.all([api("/vendor-portal/notifications"), api("/vendor-portal/tenders")]);
      box.innerHTML = bellRowsHtml(notes, tenders);
      wireBellRows(box, () => {
        renderNotifications();
        refreshChrome();
      });
      box.querySelectorAll("[data-open-bid]").forEach((b) =>
        b.addEventListener("click", () => {
          closeMenus();
          openTenderBid(Number(b.dataset.openBid));
        })
      );
    } catch (err) {
      box.innerHTML = `<div class="ep-dropdown-head">Notifications</div><div class="ep-dropdown-empty">Could not load notifications.</div>`;
    }
    return;
  }
  const rows = notificationRows();
  box.innerHTML = rows.length
    ? `<div class="ep-dropdown-head">Needs your attention</div>${rows
        .map((r) => `<button class="ep-dropdown-item" type="button" data-view="${r.view}"><span>${esc(r.label)}</span><span class="nav-badge">${esc(r.n)}</span></button>`)
        .join("")}`
    : `<div class="ep-dropdown-head">Notifications</div><div class="ep-dropdown-empty">You're all caught up.</div>`;
  box.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      closeMenus();
      switchView(b.dataset.view);
    })
  );
}

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function renderUserMenu() {
  const name = state.user?.full_name || state.vendor?.legal_name || "";
  const role = document.querySelector("#whoami .who-role")?.textContent || "";
  $("user-btn").textContent = initials(name);
  $("user-menu-avatar").textContent = initials(name);
  $("user-menu-name").textContent = name;
  $("user-menu-role").textContent = role;
}

function closeMenus() {
  for (const [menu, btn] of [["notifications-menu", "notifications-btn"], ["user-menu", "user-btn"]]) {
    $(menu).hidden = true;
    $(btn).setAttribute("aria-expanded", "false");
  }
  $("search-results").hidden = true;
}

function toggleMenu(menuId, btnId, beforeOpen) {
  const open = $(menuId).hidden;
  closeMenus();
  if (open) {
    beforeOpen?.();
    $(menuId).hidden = false;
    $(btnId).setAttribute("aria-expanded", "true");
  }
}

function renderSearchResults(data) {
  const isVendor = state.actorType === "vendor";
  const groups = SEARCH_GROUPS[isVendor ? "vendor" : "staff"].map(([key, title, view]) => ({ title, view, items: data[key] || [] })).filter((g) => g.items.length);
  const box = $("search-results");
  box.hidden = false;
  box.innerHTML = groups.length
    ? groups
        .map(
          (g) => `<div class="ep-search-group">${esc(g.title)}</div>${g.items
            .map((it) => `<button class="ep-search-item" type="button" data-id="${it.id}" data-view="${g.view || ""}"><span>${esc(it.label)}</span><span class="ep-sub">${esc(it.sub)}</span></button>`)
            .join("")}`
        )
        .join("")
    : `<div class="ep-dropdown-empty">No matches.</div>`;
  box.querySelectorAll("[data-id]").forEach((b) =>
    b.addEventListener("click", () => {
      closeMenus();
      $("search-input").value = "";
      // Vendor results carry no view (a vendor has no tab to land a result
      // on) -- they go straight to that tender's bid page instead.
      if (b.dataset.view) switchView(b.dataset.view);
      else openTenderBid(Number(b.dataset.id));
    })
  );
}

let searchTimer = null;
let searchSeq = 0;

function onSearchInput(e) {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) {
    $("search-results").hidden = true;
    return;
  }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const data = await api(`${searchEndpoint()}?q=${encodeURIComponent(q)}`);
      if (seq === searchSeq) renderSearchResults(data);
    } catch (err) {
      // a failed search just leaves the previous results in place
    }
  }, 250);
}

// Whole-sidebar collapse (Vuexy-style, 2026-10-07): a thin icon rail, same
// idea as the theme choice -- remembered, applied as a body class so every
// affected rule lives in CSS rather than being toggled here element by element.
function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  $("sidebar-collapse-btn")?.setAttribute("aria-expanded", String(!collapsed));
  // Collapsing always shows the true collapsed rail immediately, whatever the
  // pointer happens to be resting on (the toggle it was just clicked with,
  // still inside the sidebar) -- it only peeks open again on the next real
  // mouseenter, not because it was already "hovering" a moment ago.
  if (collapsed) $("sidebar").classList.remove("sidebar-peek");
}

function toggleSidebarCollapsed() {
  const next = !document.body.classList.contains("sidebar-collapsed");
  writeStored("sidebarCollapsed", String(next));
  applySidebarCollapsed(next);
}

function initGroups() {
  const saved = (() => {
    try {
      return JSON.parse(readStored("navGroups") || "{}");
    } catch (err) {
      return {};
    }
  })();
  document.querySelectorAll(".ep-navgroup").forEach((group) => {
    const key = group.dataset.group;
    group.classList.toggle("collapsed", saved[key] === true);
    group.querySelector(".ep-navgroup-head").setAttribute("aria-expanded", String(saved[key] !== true));
    group.querySelector(".ep-navgroup-head").addEventListener("click", () => {
      const collapsed = !group.classList.contains("collapsed");
      group.classList.toggle("collapsed", collapsed);
      group.querySelector(".ep-navgroup-head").setAttribute("aria-expanded", String(!collapsed));
      const all = {};
      document.querySelectorAll(".ep-navgroup.collapsed").forEach((g) => (all[g.dataset.group] = true));
      writeStored("navGroups", JSON.stringify(all));
    });
  });
}

export function initShell() {
  hydrateIcons();
  applyTheme(readStored("theme") === "dark" ? "dark" : "light");
  $("theme-toggle").addEventListener("click", toggleTheme);
  applySidebarCollapsed(readStored("sidebarCollapsed") === "true");
  $("sidebar-collapse-btn").addEventListener("click", (e) => {
    e.stopPropagation(); // sits inside the brand row, which also navigates home on click
    toggleSidebarCollapsed();
  });
  // Tracked in JS, not CSS :hover -- see the comment above .sidebar-peek in styles.css.
  $("sidebar").addEventListener("mouseenter", () => $("sidebar").classList.add("sidebar-peek"));
  $("sidebar").addEventListener("mouseleave", () => $("sidebar").classList.remove("sidebar-peek"));
  $("notifications-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu("notifications-menu", "notifications-btn", renderNotifications);
  });
  $("user-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu("user-menu", "user-btn", renderUserMenu);
  });
  $("user-menu").addEventListener("click", (e) => e.stopPropagation());
  $("notifications-menu").addEventListener("click", (e) => e.stopPropagation());
  $("menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("sidebar").classList.toggle("open");
    $("menu-btn").setAttribute("aria-expanded", String(open));
  });
  $("sidebar").addEventListener("click", (e) => {
    if (e.target.closest(".tab-btn")) $("sidebar").classList.remove("open");
  });
  $("search-input").addEventListener("input", onSearchInput);
  $("search-input").addEventListener("focus", () => $("search-results").innerHTML && ($("search-results").hidden = false));
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenus();
      $("search-input").blur();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("search-input").focus();
    }
  });
  // The dot on the bell follows the sidebar badges, whichever code path updates them.
  new MutationObserver(() => {
    $("notifications-dot").hidden = notificationRows().length === 0;
  }).observe($("topnav"), { subtree: true, childList: true, characterData: true });
  initGroups();
}
