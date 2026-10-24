import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

// One standard "reason for X" dialog, replacing the promptAsync-then-
// confirmAsync pair every decide()-style action used to chain (real bug,
// found 2026-10-24: every one of those pairs had its own title, its own
// wording, its own confirm-button label, a single-line input with no
// length limit or counter, and only a non-empty check -- no minimum length,
// no rejection of whitespace-only text). This is the one place that rule
// lives now: trimmed-non-empty, at least `minLength` characters, capped at
// `maxLength`, validated the moment the field loses focus AND again on
// submit (so a user who never blurs still can't submit something invalid).
// Mirrors backend/app/schemas/validators.py's require_reason() exactly, so
// the two can't drift apart -- same messages, same rule.
function validateReason(value: string, minLength: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Reason is required";
  if (trimmed.length < minLength) return "Enter at least 10 characters";
  return null;
}

export function ReasonDialog({
  title,
  message,
  placeholder,
  confirmLabel = "Confirm",
  danger = false,
  maxLength = 500,
  minLength = 10,
  onSubmit,
  onCancel,
}: {
  title: string;
  message?: string;
  placeholder: string;
  confirmLabel?: string;
  danger?: boolean;
  maxLength?: number;
  minLength?: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const error = touched ? validateReason(value, minLength) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (validateReason(value, minLength)) return;
    onSubmit(value.trim());
  };

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>{title}</h3>
        {message && <p id="modal-message">{message}</p>}
        <form onSubmit={submit}>
          <div id="modal-body">
            <div className="ep-k">
              Reason
              <span className="required-mark">*</span>
            </div>
            <textarea
              className="input"
              rows={4}
              placeholder={placeholder}
              value={value}
              maxLength={maxLength}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            <div className="d-flex justify-between items-center mt-4px">
              <span className="field-error">{error || ""}</span>
              <span className="ep-sub nowrap">
                {value.length}/{maxLength}
              </span>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className={`modal-confirm-btn${danger ? " danger" : ""}`}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
