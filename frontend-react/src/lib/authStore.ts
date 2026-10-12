import { useSyncExternalStore } from "react";
import type { CurrentUser, VendorDetail } from "./types";

// Replaces frontend/js/state.js (the shared mutable `state` object) now that
// the whole app is one React tree -- there's no more separate vanilla bundle
// for a `window` bridge to reach, so this is a plain external store instead.
// Still reads/writes the SAME sessionStorage keys the login flow always
// has, so a page reload restores the session exactly like before.
export interface AuthState {
  token: string | null;
  actorType: "staff" | "vendor" | null;
  user: CurrentUser | null;
  vendor: VendorDetail | null;
}

let state: AuthState = {
  token: sessionStorage.getItem("token") || null,
  actorType: (sessionStorage.getItem("actorType") as AuthState["actorType"]) || null,
  user: null,
  vendor: null,
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Sets token/actorType/user/vendor together and mirrors token/actorType to
// sessionStorage -- same single-call replacement for what every login
// handler used to do by hand inline (frontend/js/state.js's old
// setAuthState()). Called identically from StaffLoginPage/VendorLoginPage;
// only the implementation moved.
export function setAuthState(args: { token: string; actorType: "staff" | "vendor"; user?: CurrentUser | null; vendor?: VendorDetail | null }) {
  state = { token: args.token, actorType: args.actorType, user: args.user ?? state.user, vendor: args.vendor ?? state.vendor };
  sessionStorage.setItem("token", args.token);
  sessionStorage.setItem("actorType", args.actorType);
  notify();
}

export function clearAuthState() {
  state = { token: null, actorType: null, user: null, vendor: null };
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("actorType");
  notify();
}

// For AppShell/Sidebar/Topbar -- the only places that need to reactively
// re-render when login/logout happens. Every other ported page already
// fetches its own data (including its own /auth/me when it needs the
// current role) rather than reading this store, so nothing else subscribes.
export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribeAuthState, getAuthState);
}
