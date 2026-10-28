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

// Quantity (2026-10-28, user-directed) -- blank is tolerated while Draft
// (isRowSavable only needs a resolved catalog entry; firstRowProblem()'s
// own submit-time gate is what actually requires qty > 0), same
// "blank isn't this validator's job" rule as percentRangeError.
export function qtyError(value: string): string | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (n <= 0) return "Must be greater than 0.";
  return null;
}

// Estimated Price per Unit (2026-10-28, user-directed) -- never mandatory
// (only used for the budget total/approval-value estimate; a missing one
// just shows as a warning, never blocks submission), so this only ever
// catches a negative number someone actually typed in.
export function nonNegativeError(value: string): string | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (n < 0) return "Must be 0 or greater.";
  return null;
}

// Stops a 4th digit from ever being typed into a 0-100 field (2026-10-28,
// user-directed) -- Min Rating, Min/Max Vendors, Min Rating Threshold
// Override, Technical/Price Weight. NOT the same thing as clamping the
// value into 0-100 (explicitly rejected earlier, see percentRangeError's
// own comment: "show the error instead of quietly correcting the value")
// -- "999" still types fine and still shows the normal red range error on
// blur, this only ever trims digit COUNT, never corrects the number itself.
// Only counts digit characters, so "100", "99.9", "-5" are all untouched.
export function clampDigits(value: string): string {
  while ((value.match(/\d/g) || []).length > 3) value = value.slice(0, -1);
  return value;
}

// QCBS Technical/Price Weight (2026-10-28, user-directed: "negative is
// accepted" was a real bug) -- unlike percentRangeError, blank/0/negative
// ARE this validator's job even though the field is only actually required
// once QCBS is chosen: schemas/tender.py's weight_positive rejects a
// non-null <=0 regardless of eval method, so the inline check matches it
// exactly rather than being looser than the backend.
export function qcbsWeightError(value: string): string | null {
  if (value.trim() === "") return null; // required-ness is a separate, QCBS-only check (firstRowProblem)
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  if (n <= 0) return "Must be greater than 0.";
  return null;
}
