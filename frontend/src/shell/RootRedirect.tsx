import { Navigate } from "react-router-dom";
import { useAuthState } from "../lib/authStore";
import { DEFAULT_VIEW_BY_ROLE } from "../lib/constants";

// Ported from frontend/js/main.js's session-restore boot logic (what used
// to decide the very first switchView() call) -- now just where the `/`
// route redirects to. A registration link (?open=TOKEN) sends a signed-out
// visitor to vendor login with that tender in the banner (login first, not
// straight to registration -- an existing vendor just logs in; "New
// vendor? Register here" carries the token into the register screen).
// Already signed in -- vendor or staff -- the token has nothing left to
// do, so it falls through to the normal landing-page redirect instead of
// interrupting it. `?view=X` (e.g. a bookmarked deep link) lands there
// directly instead of the role's default, same as before.
const openLinkToken = new URLSearchParams(location.search).get("open");
if (openLinkToken) sessionStorage.setItem("openLinkToken", openLinkToken);

export function RootRedirect() {
  const { token, actorType, user } = useAuthState();

  if (openLinkToken && !token) return <Navigate to="/vendor-login" replace />;
  if (!token) return <Navigate to="/login" replace />;

  const deepLink = new URLSearchParams(location.search).get("view");
  if (actorType === "vendor") return <Navigate to={"/" + (deepLink || "vendor-dashboard")} replace />;
  return <Navigate to={"/" + (deepLink || DEFAULT_VIEW_BY_ROLE[user?.role ?? ""] || "dashboard")} replace />;
}
