import { FIELD_VALIDATORS } from "../auth/registerValidation";

// On-the-spot field validation for the System Admin's "Add Hospital Staff"
// and "Add Facility" dialogs (2026-10-24, user-reported: these two relied
// entirely on bare HTML `required`/type="email" and a single generic error
// banner shown only once the API call came back -- unlike every other form
// in this app (registration, login), nothing was checked as the admin typed,
// and a duplicate email/legal entity code only surfaced after a full
// round-trip, with no field highlighted. Same on-blur-error-under-the-field
// pattern as registration/login: `email` and `password` are reused directly
// from registerValidation.ts, not redefined, so the rule can't drift between
// forms that both set/check a real password.
//
// The "already exists" checks below are genuinely client-side (compared
// against the facilities/staff list the page already has in hand, not a new
// endpoint) -- they catch the common case (typo'd a code/email that's
// already in the table in front of you) instantly, but the backend's own
// check (routers/staff.py, routers/facilities.py) stays the real guard:
// nothing here is a substitute for it, just faster feedback than waiting for
// a 409.
export const FACILITY_FIELD_VALIDATORS = (existingCodes: string[]): Record<string, (value: string) => string | null> => ({
  name: (v) => (v.trim() ? null : "Facility name is required."),
  legal_entity_code: (v) => {
    const t = v.trim();
    if (!t) return "Legal entity code is required.";
    return existingCodes.some((c) => c.trim().toLowerCase() === t.toLowerCase()) ? "A facility with this legal entity code already exists." : null;
  },
});

export const STAFF_FIELD_VALIDATORS = (existingEmails: string[]): Record<string, (value: string) => string | null> => ({
  full_name: (v) => (v.trim() ? null : "Full name is required."),
  email: (v) => {
    const formatErr = FIELD_VALIDATORS.email(v);
    if (formatErr) return formatErr;
    const t = v.trim().toLowerCase();
    return existingEmails.some((e) => e.trim().toLowerCase() === t) ? "An account with this email already exists." : null;
  },
  password: FIELD_VALIDATORS.password,
  // Only checked when the role is Approving Authority -- callers skip this
  // validator entirely otherwise, same as the backend's own
  // tier_only_for_authority (schemas/staff.py) only enforcing it there.
  approval_tier: (v) => {
    const n = Number(v);
    return v.trim() && Number.isInteger(n) && n >= 1 ? null : "An Approving Authority needs an approval tier of 1 or higher.";
  },
});
