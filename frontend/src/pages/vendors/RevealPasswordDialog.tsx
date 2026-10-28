import { useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { DialogShell } from "../../components/DialogShell";
import { PasswordField } from "../../components/PasswordField";
import { Req } from "../../components/Req";
import { FieldError } from "../../components/FieldError";

// Ported 1:1 from frontend/js/pages/vendorReveal.js's askRevealPassword().
export function RevealPasswordDialog({
  vendorId,
  field,
  label,
  onClose,
  onRevealed,
}: {
  vendorId: number;
  field: string;
  label: string;
  onClose: () => void;
  onRevealed: (value: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  // This re-enters the user's OWN existing password, not a new one -- the
  // backend verifies it's correct, so the only client-side rule here is
  // "did they type something at all", not FIELD_VALIDATORS.password's
  // strength rule (an older account's real password may predate it).
  const checkPassword = (v: string) => {
    const err = v ? "" : "Password is required.";
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
      const res = await api<{ value: string | null }>(`/vendors/${vendorId}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, password }),
      });
      onClose();
      onRevealed(res.value ?? "—");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPassword("");
    }
  };

  return (
    <DialogShell kicker="Protected detail" title={`Show ${label}`}>
      <form className="ep-form padding-16px-18px bg-transparent border-0" noValidate onSubmit={submit}>
        <div className="hint">This is personal / financial information. Enter your own password to view it.</div>
        <div className="ep-field">
          <div className="ep-k">
            Your password
            <Req />
          </div>
          <PasswordField
            ref={passwordRef}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={(e) => checkPassword(e.target.value)}
            required
            autoFocus
          />
          <FieldError errors={{ password: fieldError }} name="password" />
        </div>
        {error && <div className="result err">{error}</div>}
        <div className="d-flex justify-end gap-10px">
          <button type="button" className="ep-b" onClick={onClose}>
            Cancel
          </button>
          <button className="ep-b" data-v="p">
            Show
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
