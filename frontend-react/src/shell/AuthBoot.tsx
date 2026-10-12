import { useEffect } from "react";
import { api } from "../lib/api";
import { useAuthState, setAuthState, clearAuthState } from "../lib/authStore";
import type { CurrentUser, VendorDetail } from "../lib/types";

// Ported from frontend/js/main.js's session-restore -- only `token`/
// `actorType` survive a reload (sessionStorage); `user`/`vendor` always
// start null again, so this re-fetches the full record once on boot,
// same as main.js always did, instead of trusting a stale/decoded token.
// An expired or otherwise invalid token clears the session the same way
// main.js's catch block did -- ProtectedLayout then redirects to /login on
// its own once `token` goes null, no navigation needed from here.
export function AuthBoot() {
  const { token, actorType, user, vendor } = useAuthState();

  useEffect(() => {
    if (!token) return;
    if (actorType === "vendor" && !vendor) {
      api<VendorDetail>("/vendor-auth/me")
        .then((v) => setAuthState({ token, actorType: "vendor", vendor: v }))
        .catch(() => clearAuthState());
    } else if (actorType === "staff" && !user) {
      api<CurrentUser>("/auth/me")
        .then((u) => setAuthState({ token, actorType: "staff", user: u }))
        .catch(() => clearAuthState());
    }
  }, [token, actorType, user, vendor]);

  return null;
}
