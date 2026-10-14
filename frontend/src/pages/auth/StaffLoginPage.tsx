import { useState } from "react";
import { api } from "../../lib/api";
import { roleLabel } from "../../lib/format";
import { DEFAULT_VIEW_BY_ROLE } from "../../lib/constants";
import { switchView, setAuthState } from "../../lib/bridge";
import { PasswordField } from "../../components/PasswordField";
import type { CurrentUser } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/staffLoginPage.js. The default form
// values (admin@medsource.local / changeme123) match vanilla's static HTML
// exactly -- a seeded dev account, not a real default credential shipped to
// users; same as that markup's own `value=` attributes.
const staffRoleLabel = (u: CurrentUser) => roleLabel(u.role) + (u.approval_tier ? ` · Tier ${u.approval_tier}` : "");

export function StaffLoginPage() {
  const [email, setEmail] = useState("admin@medsource.local");
  const [password, setPassword] = useState("changeme123");
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = new URLSearchParams({ username: email, password });
      const { access_token } = await api<{ access_token: string }>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      setAuthState({ token: access_token, actorType: "staff" });
      const user = await api<CurrentUser>("/auth/me");
      setAuthState({ token: access_token, actorType: "staff", user });

      setResult({ message: `Logged in as ${user.full_name} (${staffRoleLabel(user)})`, ok: true });
      // AppShell reads the role/name straight from the auth store (set just
      // above) and re-renders the sidebar/topbar on its own -- no separate
      // "show these tabs now" call needed once that chrome is React too.
      switchView(DEFAULT_VIEW_BY_ROLE[user.role] || "tenders");
    } catch (err) {
      setResult({ message: "Login failed: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  return (
    <>
      <div>
        <div className="landing-title">MedSource</div>
        <p className="hint mt-4px">Hospital E-Procurement Portal</p>
      </div>
      <div className="fs-24px fw-800 mt-14px">Staff login</div>
      <form className="ep-pane ep-pane-pad ep-form" onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">Email</div>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="ep-field">
          <div className="ep-k">Password</div>
          <PasswordField required value={password} onChange={(e) => setPassword(e.target.value)} />
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
        Supplier?{" "}
        <button type="button" className="link-btn" onClick={() => switchView("vendor-login")}>
          Click here to log in
        </button>
      </p>
    </>
  );
}
