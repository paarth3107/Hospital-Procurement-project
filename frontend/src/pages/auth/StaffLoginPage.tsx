import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { roleLabel } from "../../lib/format";
import { DEFAULT_VIEW_BY_ROLE } from "../../lib/constants";
import { switchView, setAuthState, setPendingForgotEmail } from "../../lib/bridge";
import { PasswordField } from "../../components/PasswordField";
import { FieldError } from "../../components/FieldError";
import { Req } from "../../components/Req";
import { LOGIN_FIELD_VALIDATORS } from "./loginValidation";
import type { CurrentUser } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/staffLoginPage.js.
const staffRoleLabel = (u: CurrentUser) => roleLabel(u.role) + (u.approval_tier ? ` · Tier ${u.approval_tier}` : "");

export function StaffLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Shared by on-blur and the final submit-time sweep -- "leave the field"
  // and "click Log in without ever touching it" both go through the same rule.
  function checkField(name: string, value: string) {
    const validator = LOGIN_FIELD_VALIDATORS[name];
    if (!validator) return null;
    const err = validator(value);
    setFieldErrors((prev) => (prev[name] === (err ?? "") ? prev : { ...prev, [name]: err ?? "" }));
    return err;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // A previous "Login failed" banner shouldn't still be on screen while a
    // fresh attempt is being validated/retried.
    setResult(null);
    const emailErr = checkField("email", email);
    const passwordErr = checkField("password", password);
    if (emailErr || passwordErr) {
      (emailErr ? emailRef : passwordRef).current?.focus();
      return;
    }
    try {
      const body = new URLSearchParams({ username: email, password });
      const { access_token } = await api<{ access_token: string }>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      // Real bug, found 2026-10-15: setting token/actorType BEFORE user was
      // ready used to leave a brief window where AuthBoot.tsx's own effect
      // saw a token with no user yet and fired its own /auth/me -- the
      // exact same request this line was about to make anyway, both at
      // once. The fix (one combined setAuthState() call, only once user is
      // already in hand) broke login outright, though (second pass, same
      // day): api() reads its auth token from sessionStorage (lib/api.ts's
      // authHeaders()), not from this function's own `access_token`
      // variable, and nothing had written it there yet -- setAuthState()
      // is the only thing that does, and it was pushed below on purpose.
      // The /auth/me call right after went out with no Authorization
      // header at all, 401ing with "Not authenticated" instead of logging
      // in. Writing the token to sessionStorage directly here (without
      // going through setAuthState -- that still waits until user is
      // ready, so AuthBoot's effect still doesn't see a change yet, and
      // the original race stays fixed) gets authHeaders() what it needs
      // for this one call without reopening that window.
      sessionStorage.setItem("token", access_token);
      const user = await api<CurrentUser>("/auth/me");
      setAuthState({ token: access_token, actorType: "staff", user });

      setResult({ message: `Logged in as ${user.full_name} (${staffRoleLabel(user)})`, ok: true });
      // AppShell reads the role/name straight from the auth store (set just
      // above) and re-renders the sidebar/topbar on its own -- no separate
      // "show these tabs now" call needed once that chrome is React too.
      switchView(DEFAULT_VIEW_BY_ROLE[user.role] || "tenders");
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : String(err), ok: false });
    }
  };

  return (
    <>
      <div className="fs-24px fw-800 mt-14px">Staff login</div>
      <form className="ep-pane ep-pane-pad ep-form" noValidate onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">
            Email
            <Req />
          </div>
          <input
            ref={emailRef}
            className={`input${fieldErrors.email ? " invalid" : ""}`}
            type="email"
            value={email}
            onChange={(e) => {
              setResult(null);
              setEmail(e.target.value);
              if (fieldErrors.email) checkField("email", e.target.value);
            }}
            onBlur={(e) => checkField("email", e.target.value)}
          />
          <FieldError errors={fieldErrors} name="email" />
        </div>
        <div className="ep-field">
          <div className="ep-k">
            Password
            <Req />
          </div>
          <PasswordField
            ref={passwordRef}
            className={fieldErrors.password ? "input invalid" : "input"}
            value={password}
            onChange={(e) => {
              setResult(null);
              setPassword(e.target.value);
              if (fieldErrors.password) checkField("password", e.target.value);
            }}
            onBlur={(e) => checkField("password", e.target.value)}
          />
          <FieldError errors={fieldErrors} name="password" />
        </div>
        <div className="d-flex items-center gap-14px">
          <button type="submit" className="ep-b" data-v="p">
            Log in
          </button>
          <button
            type="button"
            className="link-btn self-center"
            onClick={() => {
              if (email.trim()) setPendingForgotEmail(email.trim());
              switchView("staff-forgot-password");
            }}
          >
            Forgot password?
          </button>
        </div>
      </form>
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
    </>
  );
}
