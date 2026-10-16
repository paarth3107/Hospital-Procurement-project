import { useEffect } from "react";
import { api, ApiError } from "../lib/api";
import { useAuthState, setAuthState, clearAuthState } from "../lib/authStore";
import type { CurrentUser, VendorDetail } from "../lib/types";

// Ported from frontend/js/main.js's session-restore -- only `token`/
// `actorType` survive a reload (sessionStorage); `user`/`vendor` always
// start null again, so this re-fetches the full record once on boot,
// same as main.js always did, instead of trusting a stale/decoded token.
// An expired or otherwise invalid token clears the session the same way
// main.js's catch block did -- ProtectedLayout then redirects to /login on
// its own once `token` goes null, no navigation needed from here.
//
// Real bug, found 2026-10-15, user-reported: this used to clear the
// session on ANY failure here, including a timeout/network error during a
// server outage -- actively wrong, not just unhelpful, since the token was
// never actually invalid, the server just didn't answer. Only an actual
// 401/403 means the token itself was rejected; anything else (status null
// = never got a response at all, or a 5xx) leaves the session alone --
// whatever page the user's on keeps its own loading/error state until a
// retry succeeds, rather than silently bouncing them to the login screen.
export function AuthBoot() {
  const { token, actorType, user, vendor } = useAuthState();

  useEffect(() => {
    if (!token) return;
    const onAuthFailure = (err: unknown) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) clearAuthState();
    };
    if (actorType === "vendor" && !vendor) {
      api<VendorDetail>("/vendor-auth/me")
        .then((v) => setAuthState({ token, actorType: "vendor", vendor: v }))
        .catch(onAuthFailure);
    } else if (actorType === "staff" && !user) {
      api<CurrentUser>("/auth/me")
        .then((u) => setAuthState({ token, actorType: "staff", user: u }))
        .catch(onAuthFailure);
    }
  }, [token, actorType, user, vendor]);

  return null;
}
