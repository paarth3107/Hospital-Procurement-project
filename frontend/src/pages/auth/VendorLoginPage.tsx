import { useState } from "react";
import { api } from "../../lib/api";
import { switchView, setAuthState } from "../../lib/bridge";
import { OpenLinkNote } from "./OpenLinkNote";
import { PasswordField } from "../../components/PasswordField";
import type { VendorDetail } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorLoginPage.js.
export function VendorLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = new URLSearchParams({ username: email, password });
      const { access_token } = await api<{ access_token: string }>("/vendor-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      // Real bug, found 2026-10-15: setting token/actorType BEFORE vendor
      // was ready used to leave a brief window where AuthBoot.tsx's own
      // effect saw a token with no vendor yet and fired its own
      // /vendor-auth/me -- the exact same request this line was about to
      // make anyway, both at once. The fix (one combined setAuthState()
      // call, only once vendor is already in hand) broke login outright,
      // though (second pass, same day): api() reads its auth token from
      // sessionStorage (lib/api.ts's authHeaders()), not from this
      // function's own `access_token` variable, and nothing had written it
      // there yet -- setAuthState() is the only thing that does, and it
      // was pushed below on purpose. The /vendor-auth/me call right after
      // went out with no Authorization header at all, 401ing with "Not
      // authenticated" instead of logging in. Writing the token to
      // sessionStorage directly here (without going through setAuthState --
      // that still waits until vendor is ready, so AuthBoot's effect
      // still doesn't see a change yet, and the original race stays
      // fixed) gets authHeaders() what it needs for this one call without
      // reopening that window.
      sessionStorage.setItem("token", access_token);
      const vendor = await api<VendorDetail>("/vendor-auth/me");
      setAuthState({ token: access_token, actorType: "vendor", vendor });

      // Done its job once they're logged in -- same cleanup as a completed registration.
      sessionStorage.removeItem("openLinkToken");

      setResult({ message: `Logged in as ${vendor.legal_name}`, ok: true });
      // AppShell reads the vendor's name/status straight from the auth
      // store (set just above) and re-renders its own chrome -- no separate
      // "show the vendor tabs now" call needed once that chrome is React too.
      // Every vendor lands on the dashboard; its status notice says what to
      // do next (verification pending -> categories -> tenders).
      switchView("vendor-dashboard");
    } catch (err) {
      setResult({ message: "Login failed: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  return (
    <>
      <button type="button" className="back-link" onClick={() => switchView("login")}>
        ← Back to staff login
      </button>
      <div className="fs-24px fw-800 mt-14px">Vendor login</div>
      <OpenLinkNote />
      <form className="ep-pane ep-pane-pad ep-form" onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">Email</div>
          <input className="input" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="ep-field">
          <div className="ep-k">Password</div>
          <PasswordField required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="d-flex items-center gap-14px">
          <button type="submit" className="ep-b" data-v="p">
            Log in
          </button>
          <button type="button" className="link-btn self-center">
            Forgot password?
          </button>
        </div>
      </form>
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
      <p className="hint">
        New vendor?{" "}
        <button type="button" className="link-btn" onClick={() => switchView("register")}>
          Register here
        </button>
      </p>
    </>
  );
}
