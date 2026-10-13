import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { DialogShell } from "../../components/DialogShell";

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
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
      <form className="ep-form padding-16px-18px bg-transparent border-0" onSubmit={submit}>
        <div className="hint">This is personal / financial information. Enter your own password to view it.</div>
        <div className="ep-field">
          <div className="ep-k">Your password</div>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
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
