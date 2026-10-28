import { useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { StaffUser } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";
import { PasswordField } from "../../components/PasswordField";
import { Req } from "../../components/Req";
import { FieldError } from "../../components/FieldError";
import { FIELD_VALIDATORS } from "../auth/registerValidation";

// Ported 1:1 from frontend/js/pages/staff/passwordDialog.js. Validation
// brought in line with the shared standard (2026-10-27, user-directed --
// "take inspo from the registration form"): FIELD_VALIDATORS.password is
// the exact same strength rule registration already enforces, not a
// separate copy; noValidate kills the native popup, the label text that
// used to be the only place the 8-20/digit/upper/lower/special rule showed
// up is now backed by a real on-blur/on-submit check.
export function PasswordResetDialog({ user, onClose, onDone }: { user: StaffUser; onClose: () => void; onDone: (message: string) => void }) {
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  const checkPassword = (v: string) => {
    const err = FIELD_VALIDATORS.password(v) ?? "";
    setFieldError(err);
    return err;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (checkPassword(password)) {
      passwordRef.current?.focus();
      return;
    }
    try {
      await api(`/staff/${user.id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      onClose();
      onDone(`Password reset for ${user.full_name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <DialogShell kicker="Reset password" title={user.full_name}>
      <form className="ep-form padding-16px-18px bg-transparent border-0" noValidate onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">
            New password (8-20 characters, with at least one digit, lowercase, uppercase and special character)
            <Req />
          </div>
          <PasswordField
            ref={passwordRef}
            minLength={8}
            maxLength={20}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={(e) => checkPassword(e.target.value)}
            required
          />
          <FieldError errors={{ password: fieldError }} name="password" />
        </div>
        {error && <div className="result err">{error}</div>}
        <div className="d-flex justify-end gap-10px">
          <button type="button" className="ep-b" onClick={onClose}>
            Cancel
          </button>
          <button className="ep-b" data-v="p">
            Set password
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
