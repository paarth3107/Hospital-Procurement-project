import { useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { ROLE_LABELS } from "../../lib/format";
import type { Facility, Role, StaffUser } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";
import { PasswordField } from "../../components/PasswordField";
import { FieldError } from "../../components/FieldError";
import { Req } from "../../components/Req";
import { STAFF_FIELD_VALIDATORS } from "./staffValidation";
import { PasswordResetDialog } from "./PasswordResetDialog";

// Ported 1:1 from frontend/js/pages/staff/staffForm.js.
//
// Real bug, found 2026-10-24 (user-reported): this used to rely entirely on
// bare `required`/type="email" and a single generic error banner shown only
// once the API call came back -- nothing was checked as the admin typed, and
// a duplicate email or a weak password only surfaced after a round-trip,
// with no field highlighted. Same on-blur-error-under-the-field pattern as
// registration/login now (staffValidation.ts), including an immediate
// client-side duplicate-email check against the staff list this page
// already has loaded -- the backend's own check (routers/staff.py) stays
// the real guard.
//
// Reset password moved in here from its own row button on StaffAccountsPage
// (2026-10-24, user-directed: "should go inside the edit tab for them") --
// it's still the same PasswordResetDialog/endpoint, just opened from inside
// Edit rather than as a separate top-level action next to it. It's its own
// dialog (stacked on top, same as before) rather than folded into this
// form's own submit, since it's a genuinely separate action with its own
// endpoint (POST /staff/{id}/reset-password, immediate, not part of the
// PUT this form's Save button sends) -- the account's other fields and its
// password were never one save together even when the button sat outside.
export function StaffFormDialog({
  user,
  facilities,
  existingEmails,
  onClose,
  onSaved,
}: {
  user: StaffUser | null;
  facilities: Facility[];
  existingEmails: string[];
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const tierRef = useRef<HTMLInputElement>(null);
  // The duplicate-email check only makes sense against OTHER accounts while
  // editing (this user's own email would otherwise always "collide" with
  // itself) -- moot either way since email is disabled once editing, but
  // kept correct rather than relying on that.
  const validators = STAFF_FIELD_VALIDATORS(editing ? existingEmails.filter((e) => e.toLowerCase() !== user!.email.toLowerCase()) : existingEmails);

  function checkField(fieldName: string, value: string) {
    const err = validators[fieldName](value);
    setFieldErrors((prev) => (prev[fieldName] === (err ?? "") ? prev : { ...prev, [fieldName]: err ?? "" }));
    return err;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const nameErr = checkField("full_name", fullName);
    const emailErr = editing ? null : checkField("email", email);
    const passwordErr = editing ? null : checkField("password", password);
    const tierErr = role === "approving_authority" ? checkField("approval_tier", approvalTier) : null;
    if (role !== "approving_authority") setFieldErrors((prev) => (prev.approval_tier ? { ...prev, approval_tier: "" } : prev));
    const firstInvalid = nameErr ? nameRef : emailErr ? emailRef : passwordErr ? passwordRef : tierErr ? tierRef : null;
    if (firstInvalid) {
      firstInvalid.current?.focus();
      return;
    }
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
      <form className="ep-form padding-16px-18px bg-transparent border-0" noValidate onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">
            Full name
            <Req />
          </div>
          <input
            ref={nameRef}
            className={`input${fieldErrors.full_name ? " invalid" : ""}`}
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (fieldErrors.full_name) checkField("full_name", e.target.value);
            }}
            onBlur={(e) => checkField("full_name", e.target.value)}
          />
          <FieldError errors={fieldErrors} name="full_name" />
        </div>
        <div className="ep-field">
          <div className="ep-k">
            Email (used to log in)
            {!editing && <Req />}
          </div>
          <input
            ref={emailRef}
            className={`input${fieldErrors.email ? " invalid" : ""}`}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) checkField("email", e.target.value);
            }}
            onBlur={(e) => !editing && checkField("email", e.target.value)}
            disabled={editing}
          />
          <FieldError errors={fieldErrors} name="email" />
          {editing && (
            <div className="d-flex items-center gap-10px mt-6px">
              <button type="button" className="ep-b" onClick={() => setResettingPassword(true)}>
                Reset password
              </button>
              {passwordMessage && <span className="ep-sub">{passwordMessage}</span>}
            </div>
          )}
        </div>
        {!editing && (
          <div className="ep-field">
            <div className="ep-k">
              Initial password (8-20 characters, with at least one digit, lowercase, uppercase and special character)
              <Req />
            </div>
            <PasswordField
              ref={passwordRef}
              className={fieldErrors.password ? "input invalid" : "input"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) checkField("password", e.target.value);
              }}
              onBlur={(e) => checkField("password", e.target.value)}
            />
            <FieldError errors={fieldErrors} name="password" />
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
            <div className="ep-k">
              Approval tier
              <Req />
            </div>
            <input
              ref={tierRef}
              className={`input${fieldErrors.approval_tier ? " invalid" : ""}`}
              type="number"
              min={1}
              value={approvalTier}
              onChange={(e) => {
                setApprovalTier(e.target.value);
                if (fieldErrors.approval_tier) checkField("approval_tier", e.target.value);
              }}
              onBlur={(e) => checkField("approval_tier", e.target.value)}
            />
            <FieldError errors={fieldErrors} name="approval_tier" />
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
      {resettingPassword && (
        <PasswordResetDialog
          user={user!}
          onClose={() => setResettingPassword(false)}
          onDone={(msg) => {
            setResettingPassword(false);
            setPasswordMessage(msg);
          }}
        />
      )}
    </DialogShell>
  );
}
