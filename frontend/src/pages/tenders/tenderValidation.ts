// Same on-blur-error-under-the-field pattern as registration/login
// (registerValidation.ts/loginValidation.ts) -- Min Rating, Min/Max
// Vendors, and the per-line Min Rating Threshold Override all share this
// one rule (2026-10-22, replacing an earlier silent-clamp-on-blur attempt:
// user-directed to show the same red error instead of quietly correcting
// the value).
export function percentRangeError(value: string): string | null {
  if (value.trim() === "") return null; // optional/defaulted elsewhere -- blank isn't this validator's job
  const n = Number(value);
  if (Number.isNaN(n)) return null; // type="number" already keeps non-numeric text out
  if (n < 0 || n > 100) return "Must be between 0 and 100.";
  return null;
}
