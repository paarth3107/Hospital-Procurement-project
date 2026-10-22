import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { switchView, setAuthState, setPendingRegistrationResume } from "../../lib/bridge";
import { OpenLinkNote } from "./OpenLinkNote";
import { PasswordField } from "../../components/PasswordField";
import { FieldError } from "../../components/FieldError";
import { LOGIN_FIELD_VALIDATORS } from "./loginValidation";
import type { VendorDetail } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorLoginPage.js.
export function VendorLoginPage() {
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

      // Registration recovery (2026-10-21): still Draft means registration
      // never actually finished (most often: the Step 1 verification email
      // never arrived) -- there's no real session to start, so don't call
      // setAuthState at all. Drop the token this one /me call needed and
      // send them back to Registration instead, carrying what's already on
      // file so Step 1 can open prefilled rather than blank.
      if (vendor.status === "draft") {
        sessionStorage.removeItem("token");
        setPendingRegistrationResume(vendor);
        switchView("register");
        return;
      }

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
      <div className="fs-24px fw-800 mt-14px">Vendor login</div>
      <OpenLinkNote />
      <form className="ep-pane ep-pane-pad ep-form" noValidate onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">Email</div>
          <input
            ref={emailRef}
            className={`input${fieldErrors.email ? " invalid" : ""}`}
            type="email"
            autoComplete="username"
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
          <div className="ep-k">Password</div>
          <PasswordField
            ref={passwordRef}
            className={fieldErrors.password ? "input invalid" : "input"}
            autoComplete="current-password"
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
          <button type="button" className="link-btn self-center">
            Forgot password?
          </button>
        </div>
      </form>
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
      <p className="hint">
        New vendor?{" "}
        <button type="button" className="link-btn link-btn-accent" onClick={() => switchView("register")}>
          Register here
        </button>
      </p>
    </>
  );
}
