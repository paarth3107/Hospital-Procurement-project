import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { switchView, takePendingForgotEmail } from "../../lib/bridge";
import { FieldError } from "../../components/FieldError";
import { Req } from "../../components/Req";
import { FIELD_VALIDATORS } from "./registerValidation";

// Same card structure as VendorLoginPage.tsx/StaffLoginPage.tsx (heading +
// ep-pane form + result banner) -- reached from either login page's
// "Forgot password?" link. `actorType` (2026-10-23, extended to staff)
// picks the right API path and "back to login" target; one component with
// a prop rather than a near-duplicate StaffForgotPasswordPage, since the
// two flows are otherwise identical.
export function ForgotPasswordPage({ actorType }: { actorType: "vendor" | "staff" }) {
  const apiPath = actorType === "staff" ? "/auth/forgot-password" : "/vendor-auth/forgot-password";
  const loginView = actorType === "staff" ? "login" : "vendor-login";
  // If the email was already typed on the login page before clicking
  // "Forgot password?", carry it over rather than asking again --
  // takePendingForgotEmail() returns null (leaving this blank) on a direct
  // link or a refresh, which is just the normal empty-field starting point.
  const [email, setEmail] = useState(() => takePendingForgotEmail() ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  function checkField(name: string, value: string) {
    const validator = FIELD_VALIDATORS[name];
    if (!validator) return null;
    const err = validator(value);
    setFieldErrors((prev) => (prev[name] === (err ?? "") ? prev : { ...prev, [name]: err ?? "" }));
    return err;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    const err = checkField("email", email);
    if (err) {
      emailRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch (err) {
      setResult({ message: "Could not send the reset link: " + (err instanceof Error ? err.message : String(err)), ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button type="button" className="back-link" onClick={() => switchView(loginView)}>
        ← Back to {actorType === "staff" ? "staff" : "vendor"} login
      </button>
      <div className="fs-24px fw-800 mt-14px">Forgot password</div>
      {sent ? (
        <div className="ep-pane ep-pane-pad d-flex flex-col gap-14px">
          <p className="hint">If that email is registered, we've sent a link to reset your password. Check your inbox.</p>
          <button type="button" className="ep-b self-start" data-v="p" onClick={() => switchView(loginView)}>
            Back to {actorType === "staff" ? "staff" : "vendor"} login
          </button>
        </div>
      ) : (
        <form className="ep-pane ep-pane-pad ep-form" noValidate onSubmit={submit}>
          <p className="hint">Enter your registered email and we'll send you a link to reset your password.</p>
          <div className="ep-field">
            <div className="ep-k">
              Email
              <Req />
            </div>
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
          <button type="submit" className="ep-b self-start" data-v="p" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
    </>
  );
}
