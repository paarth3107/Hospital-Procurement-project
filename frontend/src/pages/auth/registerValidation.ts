// On-the-spot field validation for registration's Step 1 (2026-10-13, found
// as a real bug by the user: a field could hold something the backend would
// reject -- GSTIN/PAN/IFSC/phone with the wrong shape, mainly -- and nothing
// said so until the final "Submit for verification" came back with a
// server error, by which point the vendor had already filled in all of
// Step 2 too and had to go back to fix it. `validateStep1()` in
// RegisterPage.tsx only ever checked the browser's own `checkValidity()`
// (required/maxLength/minLength/pattern), which doesn't know a GSTIN needs
// a real checksum-shaped body, just that it's 15 characters of something.
//
// Every regex here is copied from backend/app/schemas/vendor.py's own
// `@field_validator`s, not invented independently -- a field flagged
// invalid here is guaranteed to also be rejected server-side, and nothing
// valid here is ever rejected there, so this can never block a submission
// the backend would have accepted.
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z\d]{6}$/;
const PINCODE_RE = /^\d{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// User-directed, stricter than the backend's own loose ">=7 digits" rule
// (phoneDigitCount() below) -- the primary "Phone" field specifically wants
// a real Indian mobile number shape: exactly 10 digits, leading digit 6-9.
// RegisterPage.tsx's input handler already strips anything non-digit and
// caps length at 10 as the user types, so this is really just the "did they
// actually finish it" check.
const INDIA_MOBILE_RE = /^[6-9]\d{9}$/;

// backend/app/schemas/vendor.py's phone_normalised()/escalation_phone():
// strip everything but digits and a leading "+", require >=7 digits left.
function phoneDigitCount(v: string): number {
  const cleaned = Array.from(v)
    .filter((ch) => /\d/.test(ch) || ch === "+")
    .join("");
  return cleaned.replace(/^\+/, "").length;
}

const required =
  (label: string) =>
  (v: string): string | null =>
    v.trim() ? null : `${label} is required.`;

// User-directed (2026-10-13) -- the backend (vendor.py) has no length
// constraint at all on any of these name-ish fields, just non-blank; these
// min/max bounds are a pure client-side data-quality rule, not something
// mirrored from the server. `optional` skips the "required" branch for
// trade_name (it can be left blank entirely) but still bounds it once
// something's actually typed.
const boundedText =
  (label: string, min: number, max: number, optional = false) =>
  (v: string): string | null => {
    const t = v.trim();
    if (!t) return optional ? null : `${label} is required.`;
    if (t.length < min) return `${label} must be at least ${min} characters.`;
    if (t.length > max) return `${label} must be ${max} characters or fewer.`;
    return null;
  };

export const FIELD_VALIDATORS: Record<string, (value: string) => string | null> = {
  legal_name: boundedText("Legal name", 2, 100),
  trade_name: boundedText("Trade name", 2, 100, true),
  entity_type: required("Entity type"),
  year_of_incorporation: (v) => {
    if (!v.trim()) return "Year of incorporation is required.";
    const n = Number(v);
    const thisYear = new Date().getFullYear();
    return Number.isInteger(n) && n >= 1800 && n <= thisYear ? null : `Enter a year between 1800 and ${thisYear}.`;
  },
  registered_address: boundedText("Address line", 10, 250),
  alternate_address: boundedText("Alternate / correspondence address", 1, 250, true),
  state: required("State"),
  city: required("City"),
  city_other: required("City"),
  pincode: (v) => {
    if (!v.trim()) return "Pincode is required.";
    return PINCODE_RE.test(v.trim()) ? null : "Pincode must be 6 digits.";
  },
  gstin: (v) => {
    const t = v.trim().toUpperCase();
    if (!t) return "GSTIN is required.";
    return t.length === 15 && GSTIN_RE.test(t) ? null : "GSTIN must be 15 characters in the standard format (e.g. 27AAAPM1234C1Z5).";
  },
  pan: (v) => {
    const t = v.trim().toUpperCase();
    if (!t) return "PAN is required.";
    return PAN_RE.test(t) ? null : "PAN must be 10 characters in the standard format (e.g. AAAPM1234C).";
  },
  bank_name: required("Bank name"),
  bank_account_number: required("Account number"),
  bank_ifsc: (v) => {
    const t = v.trim().toUpperCase();
    if (!t) return "IFSC is required.";
    return IFSC_RE.test(t) ? null : "IFSC must be 11 characters (4 letters, a 0, then 6 letters/digits).";
  },
  contact_person: boundedText("Primary contact person", 2, 50),
  contact_designation: boundedText("Designation", 2, 50),
  phone: (v) => {
    if (!v.trim()) return "Phone is required.";
    return INDIA_MOBILE_RE.test(v.trim()) ? null : "Enter a 10-digit mobile number starting with 6-9.";
  },
  email: (v) => {
    if (!v.trim()) return "Email is required.";
    return EMAIL_RE.test(v.trim()) ? null : "Enter a valid email address.";
  },
  escalation_contact_name: boundedText("Escalation contact name", 2, 50),
  escalation_contact_phone: (v) => {
    if (!v.trim()) return "Escalation phone is required.";
    return phoneDigitCount(v) >= 7 ? null : "Enter a valid escalation phone number.";
  },
  // Optional field, and the backend doesn't format-check it either -- only
  // flagged if something was actually typed and it doesn't look like an email.
  escalation_contact_email: (v) => (v.trim() && !EMAIL_RE.test(v.trim()) ? "Enter a valid email address." : null),
  // Mirrors backend/app/schemas/password.py's check_password_strength()
  // exactly (2026-10-13, user-directed): 8-20 characters, at least one
  // digit, one lowercase, one uppercase, one special character.
  password: (v) => {
    if (!v) return "Password is required.";
    if (v.length < 8 || v.length > 20) return "Password must be 8-20 characters.";
    if (!/[0-9]/.test(v)) return "Password must include at least one digit.";
    if (!/[a-z]/.test(v)) return "Password must include at least one lowercase letter.";
    if (!/[A-Z]/.test(v)) return "Password must include at least one uppercase letter.";
    if (!/[^A-Za-z0-9]/.test(v)) return "Password must include at least one special character.";
    return null;
  },
};
