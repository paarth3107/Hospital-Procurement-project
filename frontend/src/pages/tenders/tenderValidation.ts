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
