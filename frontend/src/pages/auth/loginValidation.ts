import { FIELD_VALIDATORS } from "./registerValidation";

// Bug report, 2026-10-16: Staff/Vendor login relied entirely on the
// browser's own `required`/type="email" validation -- the native popups
// ("Please include an '@'...", "Please fill out this field.") whose wording
// and timing vary by browser, show nothing on blur, and still left the old
// "Login failed: ..." banner on screen while a fresh attempt was being
// retyped. Same on-blur-error-under-the-field pattern as registration
// (registerValidation.ts/RegisterPage.tsx), just for the two fields a login
// form actually has. Email reuses registration's own validator exactly --
// same message, same rule -- rather than defining a second one. Password
// here is login-only ("did you type something") not registration's
// strength check (that's a rule about *setting* a password, not using one).
export const LOGIN_FIELD_VALIDATORS: Record<string, (value: string) => string | null> = {
  email: FIELD_VALIDATORS.email,
  password: (v) => (v ? null : "Password is required."),
};
