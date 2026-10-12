import { useState } from "react";
import { api } from "../../lib/api";
import { switchView, setAuthState } from "../../lib/bridge";
import { OpenLinkNote } from "./OpenLinkNote";
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
      setAuthState({ token: access_token, actorType: "vendor" });
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
          <input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="d-flex items-center gap-14px">
          <button type="submit" className="ep-b" data-v="p">
            Log in
          </button>
          <button type="button" className="link-btn">
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
