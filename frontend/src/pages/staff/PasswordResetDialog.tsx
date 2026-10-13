import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { StaffUser } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";

// Ported 1:1 from frontend/js/pages/staff/passwordDialog.js.
export function PasswordResetDialog({ user, onClose, onDone }: { user: StaffUser; onClose: () => void; onDone: (message: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
      <form className="ep-form padding-16px-18px bg-transparent border-0" onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">New password (min 8 characters)</div>
          <input className="input" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
