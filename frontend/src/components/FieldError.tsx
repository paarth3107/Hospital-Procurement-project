// The error line directly under a field, shown once that field has actually
// been checked. Extracted from RegisterPage.tsx (2026-10-16) so login's own
// field-level validation can use the exact same look instead of reinventing it.
export function FieldError({ errors, name }: { errors: Record<string, string>; name: string }) {
  return errors[name] ? <div className="field-error">{errors[name]}</div> : null;
}
