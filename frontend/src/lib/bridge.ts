// The stable call surface every already-ported page uses for navigation
// and cross-page deep-link state. Until the Final Phase (2026-10-12) this
// reached through `window` into a separate vanilla bundle -- a bundled
// copy of a shared-state module's source would otherwise give each bundle
// its OWN copy of that state, a different object in memory than the one
// actually driving the page. Now that the whole app is one React tree,
// there's no bundle boundary left to cross: every export below just holds
// plain module-level state directly, and `switchView`/`refreshChrome`/
// `setAuthState` delegate to the real implementations in lib/router.ts,
// lib/chromeStore.ts and lib/authStore.ts. Every call site elsewhere in the
// app is UNCHANGED -- same function names, same signatures -- only what's
// behind them moved.
export { switchView } from "./router";
export { refreshChrome } from "./chromeStore";
export { setAuthState } from "./authStore";
import type { VendorDetail } from "./types";

// pendingListFilter: still used by VendorListPage to pick its status filter
// when navigating back from a vendor it opened. Real bug, fixed 2026-10-22:
// *which* vendor/tender to open used to be this same kind of transient
// module state (viewVendorId / pendingTenderId) instead of a URL param --
// VendorViewPage/TenderEditorPage are now reached at /vendor-view/:id and
// /tender-edit/:id, which (a) actually works with the browser's own
// back/forward/refresh and a direct link, none of which this module state
// ever survived, and (b) fixed a second, independent bug where "Open" from
// the dashboard's Action Queue never actually used this state at all --
// openTask() switched to the LIST view, not the detail one, so the id this
// module held was set but never read.
let pendingListFilter: string | null = null;

export const setPendingListFilter = (f: string) => {
  pendingListFilter = f;
};
export const takePendingListFilter = (): string | null => {
  const f = pendingListFilter;
  pendingListFilter = null;
  return f;
};

// Mirrors frontend/js/pages/approvalReviewState.js's shape.
let pendingReviewId: number | undefined;

export const setPendingReviewId = (id: number) => {
  pendingReviewId = id;
};
export const takePendingReviewId = (): number | null => {
  const id = pendingReviewId;
  pendingReviewId = undefined;
  return id ?? null;
};

// Mirrors frontend/js/pages/awards/awardState.js's shape.
let pendingAwardId: number | undefined;

export const setPendingAwardId = (id: number) => {
  pendingAwardId = id;
};
export const takePendingAwardId = (): number | null => {
  const id = pendingAwardId;
  pendingAwardId = undefined;
  return id ?? null;
};

// Mirrors frontend/js/pages/bid/bidState.js's shape.
let pendingBidTenderId: number | undefined;

export const setPendingBidTenderId = (id: number) => {
  pendingBidTenderId = id;
};
export const takePendingBidTenderId = (): number | null => {
  const id = pendingBidTenderId;
  pendingBidTenderId = undefined;
  return id ?? null;
};

// Registration recovery (2026-10-21): a vendor who logs in while still
// Draft (vendor-auth/login never checks status except Blacklisted) is sent
// to Registration instead of the dashboard, carrying everything already on
// file so Step 1 can open prefilled and editable rather than blank.
let pendingRegistrationResume: VendorDetail | undefined;

export const setPendingRegistrationResume = (vendor: VendorDetail) => {
  pendingRegistrationResume = vendor;
};
export const takePendingRegistrationResume = (): VendorDetail | null => {
  const vendor = pendingRegistrationResume;
  pendingRegistrationResume = undefined;
  return vendor ?? null;
};
