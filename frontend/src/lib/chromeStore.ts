import { useSyncExternalStore } from "react";
import { api } from "./api";
import { getAuthState } from "./authStore";
import { closingSoonTenders } from "./vendorNotifications";

// Replaces frontend/js/nav.js's refreshChrome() -- sidebar badges and the
// topbar's fact strip, computed from the same real counts the dashboard
// itself shows (staff only has page-facts; a vendor only has two badges).
// Several already-ported pages call refreshChrome() after an action that
// changes one of these counts (approve a vendor, verify a document, ...) to
// refresh immediately rather than wait for the next navigation -- same
// signature, same call sites, kept working via this store instead of a
// `window` bridge into vanilla DOM writes.
export interface ChromeState {
  badgeQueue: number;
  badgeMappings: number;
  badgeApprovals: number;
  badgeAwards: number;
  badgeDecisions: number;
  badgeStaffNotifications: number;
  badgeVendorCategories: number;
  badgeVendorDashboard: number;
  openTendersCount: number | null;
  nextBidClose: string | null;
}

const EMPTY: ChromeState = {
  badgeQueue: 0,
  badgeMappings: 0,
  badgeApprovals: 0,
  badgeAwards: 0,
  badgeDecisions: 0,
  badgeStaffNotifications: 0,
  badgeVendorCategories: 0,
  badgeVendorDashboard: 0,
  openTendersCount: null,
  nextBidClose: null,
};

let state: ChromeState = EMPTY;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getChromeState(): ChromeState {
  return state;
}
export function subscribeChromeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useChromeState(): ChromeState {
  return useSyncExternalStore(subscribeChromeState, getChromeState);
}

interface DashboardStatsForChrome {
  vendors_pending_count: number;
  docs_to_verify: unknown[];
  award_tasks: unknown[];
  pending_approval_count: number;
  mappings_pending_count: number;
  open_tenders_count: number;
  next_bid_close: string | null;
  pending_decisions: unknown[];
}
interface VendorPortalTenderForChrome {
  can_bid: boolean;
  bid_due_date: string | null;
  tender_id: number;
  title: string;
}
interface VendorNotificationForChrome {
  read: boolean;
}
interface StaffNotificationForChrome {
  read: boolean;
}

export async function refreshChrome() {
  const { token, actorType } = getAuthState();
  if (!token) return;
  if (actorType === "vendor") {
    try {
      const reqs = await api<{ summary: string }[]>("/vendor-portal/documents/requirements");
      const [notes, tenders] = await Promise.all([
        api<VendorNotificationForChrome[]>("/vendor-portal/notifications"),
        api<VendorPortalTenderForChrome[]>("/vendor-portal/tenders"),
      ]);
      state = {
        ...state,
        badgeVendorCategories: reqs.filter((r) => r.summary === "documents_needed").length,
        badgeVendorDashboard: notes.filter((n) => !n.read).length + closingSoonTenders(tenders).length,
      };
      notify();
    } catch {
      // chrome is decorative; a failed refresh must never block the screen
    }
    return;
  }
  try {
    const [s, notes] = await Promise.all([api<DashboardStatsForChrome>("/dashboard/stats"), api<StaffNotificationForChrome[]>("/staff-notifications")]);
    applyDashboardStats(s);
    state = { ...state, badgeStaffNotifications: notes.filter((n) => !n.read).length };
    notify();
  } catch {
    // chrome is decorative; a failed refresh must never block the screen
  }
}

// Split out of refreshChrome() above (2026-10-15, found via the browser's
// own network panel: landing on /dashboard fired two /dashboard/stats
// requests at once -- this one from AppShell's refreshChrome(), a second,
// separate one from DashboardPage.tsx's own full-stats fetch for its
// actual content, same endpoint, same moment). DashboardPage now calls
// this directly with the stats it already has instead of letting
// AppShell's effect fetch the identical thing again for that one route.
export function applyDashboardStats(s: DashboardStatsForChrome) {
  state = {
    ...state,
    badgeQueue: s.vendors_pending_count + s.docs_to_verify.length,
    badgeAwards: s.award_tasks.length,
    badgeApprovals: s.pending_approval_count,
    badgeDecisions: s.pending_decisions.length,
    badgeMappings: s.mappings_pending_count,
    openTendersCount: s.open_tenders_count,
    nextBidClose: s.next_bid_close,
  };
  notify();
}

// Vendor-side equivalent of applyDashboardStats above (2026-10-28,
// user-reported: "vendor dashboard making too many repeated requests") --
// the exact same duplicate-fetch bug applyDashboardStats was built to fix
// for the staff Dashboard (see its own comment), just never finished for
// VendorDashboardPage.tsx: AppShell's mount effect below only ever skipped
// refreshChrome() for `/dashboard`, never `/vendor-dashboard`, so a vendor
// landing there fired /vendor-portal/tenders and /vendor-portal/documents/
// requirements TWICE at once -- once here, once from the dashboard's own
// page-content fetch. VendorDashboardPage now calls this directly with
// data it already fetched instead.
interface VendorPortalStatsForChrome {
  requirements: { summary: string }[];
  notifications: VendorNotificationForChrome[];
  tenders: VendorPortalTenderForChrome[];
}
export function applyVendorPortalStats(s: VendorPortalStatsForChrome) {
  state = {
    ...state,
    badgeVendorCategories: s.requirements.filter((r) => r.summary === "documents_needed").length,
    badgeVendorDashboard: s.notifications.filter((n) => !n.read).length + closingSoonTenders(s.tenders).length,
  };
  notify();
}

export function resetChromeState() {
  state = EMPTY;
  notify();
}
