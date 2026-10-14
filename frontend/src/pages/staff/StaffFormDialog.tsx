import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { ROLE_LABELS } from "../../lib/format";
import type { Facility, Role, StaffUser } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";
import { PasswordField } from "../../components/PasswordField";

// Ported 1:1 from frontend/js/pages/staff/staffForm.js.
export function StaffFormDialog({
  user,
  facilities,
  onClose,
  onSaved,
}: {
  user: StaffUser | null;
  facilities: Facility[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = !!user;
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "procurement_officer");
  const [approvalTier, setApprovalTier] = useState(user?.approval_tier ? String(user.approval_tier) : "");
  const [facilityId, setFacilityId] = useState(user?.facility_id != null ? String(user.facility_id) : "");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      full_name: fullName,
      role,
      facility_id: facilityId ? Number(facilityId) : null,
      approval_tier: role === "approving_authority" && approvalTier ? Number(approvalTier) : null,
      ...(editing ? {} : { email, password }),
    };
    try {
      await api(editing ? `/staff/${user!.id}` : "/staff", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onClose();
      onSaved(editing ? `Updated ${fullName}.` : `Created an account for ${fullName} (${email}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <DialogShell kicker={editing ? "Edit staff account" : "New staff account"} title={editing ? user!.full_name : "Add Hospital Staff"}>
      <form className="ep-form padding-16px-18px bg-transparent border-0" onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">Full name</div>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="ep-field">
          <div className="ep-k">Email (used to log in)</div>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={editing} required={!editing} />
        </div>
        {!editing && (
          <div className="ep-field">
            <div className="ep-k">Initial password (8-20 characters, with at least one digit, lowercase, uppercase and special character)</div>
            <PasswordField minLength={8} maxLength={20} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <div className="hint mt-4px">Share it with the person directly; there is no email delivery yet. Use Reset password later to change it.</div>
          </div>
        )}
        <div className="ep-field">
          <div className="ep-k">Role</div>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {role === "approving_authority" && (
          <div className="ep-field">
            <div className="ep-k">Approval tier</div>
            <input className="input" type="number" min={1} value={approvalTier} onChange={(e) => setApprovalTier(e.target.value)} />
            <div className="hint mt-4px">Higher tiers can approve higher-value tenders (see the approval bands).</div>
          </div>
        )}
        <div className="ep-field">
          <div className="ep-k">Facility</div>
          <select className="input" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            <option value="">All facilities</option>
            {facilities.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="result err">{error}</div>}
        <div className="d-flex justify-end gap-10px">
          <button type="button" className="ep-b" onClick={onClose}>
            Cancel
          </button>
          <button className="ep-b" data-v="p">
            {editing ? "Save changes" : "Create account"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
