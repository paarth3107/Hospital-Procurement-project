import { useState, type InputHTMLAttributes } from "react";

// Show/hide toggle for every password field on login and registration
// (2026-10-13, user-requested) -- a thin wrapper around a plain <input>, so
// it drops in wherever type="password" was, controlled or uncontrolled,
// keeping every other prop (value, onChange, name, required, minLength,
// maxLength, autoComplete, ...) exactly as the caller passed it. No icon
// library -- a small inline SVG, same approach as CircularProgress.tsx's own
// hand-rolled ring.
export function PasswordField({ className, ...inputProps }: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <input {...inputProps} type={show ? "text" : "password"} className={`${className ?? "input"} password-field-input`} />
      <button
        type="button"
        className="password-field-toggle"
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
        onClick={() => setShow((s) => !s)}
      >
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
