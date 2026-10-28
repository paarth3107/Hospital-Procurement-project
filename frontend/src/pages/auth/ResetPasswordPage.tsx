import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { switchView } from "../../lib/bridge";
import { PasswordField } from "../../components/PasswordField";
import { FieldError } from "../../components/FieldError";
import { Req } from "../../components/Req";
import { FIELD_VALIDATORS } from "./registerValidation";

// Reached only via the link emailed by ForgotPasswordPage's submit --
// `token` comes from the URL (`/reset-password/:token` or
// `/staff-reset-password/:token`), never asked for again on this page
// (explicitly user-directed: only the new password is asked here, not the
// email a second time). Same card structure as the login pages; the
// success state mirrors RegisterPage.tsx's own confirmation-screen +
// countdown pattern, just a much shorter message (user-directed: "keep
// this message short af"). `actorType` (2026-10-23, extended to staff)
// picks the right API path and "back to login" target -- the two flows
// are otherwise identical, so this is one component with a prop rather
// than a near-duplicate StaffResetPasswordPage.
const REDIRECT_DELAY_SECONDS = 5;

export function ResetPasswordPage({ actorType }: { actorType: "vendor" | "staff" }) {
  const apiPath = actorType === "staff" ? "/auth/reset-password" : "/vendor-auth/reset-password";
  const loginView = actorType === "staff" ? "login" : "vendor-login";
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [redirectSeconds, setRedirectSeconds] = useState(REDIRECT_DELAY_SECONDS);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!done) return;
    let remaining = REDIRECT_DELAY_SECONDS;
    const interval = setInterval(() => {
      remaining -= 1;
      setRedirectSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        switchView(loginView);
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  function checkField(name: string, value: string) {
    let err: string | null;
    if (name === "confirm") {
      err = value ? (value === password ? null : "Passwords don't match.") : "Re-enter your password.";
    } else {
      err = FIELD_VALIDATORS.password(value);
    }
    setFieldErrors((prev) => (prev[name] === (err ?? "") ? prev : { ...prev, [name]: err ?? "" }));
    return err;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const passwordErr = checkField("password", password);
    const confirmErr = checkField("confirm", confirm);
    if (passwordErr || confirmErr) {
      (passwordErr ? passwordRef : confirmRef).current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      setDone(true);
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : String(err), ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="ep-pane ep-pane-pad d-flex flex-col gap-14px">
        <div className="fs-24px fw-800">Password Changed!</div>
        <div className="d-flex items-center gap-14px flex-wrap">
          <button type="button" className="ep-b" data-v="p" onClick={() => switchView(loginView)}>
            Go to {actorType === "staff" ? "staff" : "vendor"} login
          </button>
          <span className="ep-sub">Redirecting in {redirectSeconds}s…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fs-24px fw-800 mt-14px">Reset password</div>
      <form className="ep-pane ep-pane-pad ep-form" noValidate onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">
            New password
            <Req />
          </div>
          <PasswordField
            ref={passwordRef}
            className={fieldErrors.password ? "input invalid" : "input"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setResult(null);
              setPassword(e.target.value);
              if (fieldErrors.password) checkField("password", e.target.value);
              if (fieldErrors.confirm && confirm) checkField("confirm", confirm);
            }}
            onBlur={(e) => checkField("password", e.target.value)}
          />
          <FieldError errors={fieldErrors} name="password" />
        </div>
        <div className="ep-field">
          <div className="ep-k">
            Re-enter password
            <Req />
          </div>
          <PasswordField
            ref={confirmRef}
            className={fieldErrors.confirm ? "input invalid" : "input"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setResult(null);
              setConfirm(e.target.value);
              if (fieldErrors.confirm) checkField("confirm", e.target.value);
            }}
            onBlur={(e) => checkField("confirm", e.target.value)}
          />
          <FieldError errors={fieldErrors} name="confirm" />
        </div>
        <button type="submit" className="ep-b self-start" data-v="p" disabled={submitting}>
          {submitting ? "Saving…" : "Set new password"}
        </button>
      </form>
      {result && (
        <div className="result err">
          {result.message}{" "}
          <button type="button" className="link-btn" onClick={() => switchView(actorType === "staff" ? "staff-forgot-password" : "forgot-password")}>
            Request a new link
          </button>
        </div>
      )}
    </>
  );
}
