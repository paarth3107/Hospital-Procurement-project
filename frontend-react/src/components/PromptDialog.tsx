import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

// React equivalent of frontend/js/modal.js's modalPrompt() -- same
// .modal-box CSS, own portal (never the vanilla #modal-overlay node). Paired
// with ConfirmDialog by useModal.tsx, which gives decide()-style code in a
// ported page the same promise-based ergonomics modalPrompt/modalConfirm had,
// so that logic can stay close to a 1:1 port instead of being rewritten into
// a dialog-state machine.
// NOTE: styles.css's padding for this message (`.modal-box p#modal-message`)
// is scoped to that id, not just the tag -- without id="modal-message" below,
// the text renders with no inset and visually runs to the box's left edge.
// Only one of these dialogs is ever open at a time (useModal.tsx), so reusing
// this id, same as the vanilla singleton dialog did, is safe.
export function PromptDialog({
  message,
  placeholder = "",
  onSubmit,
  onCancel,
}: {
  message: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>Input Required</h3>
        <p id="modal-message">{message}</p>
        <form onSubmit={submit}>
          <div id="modal-body">
            <input className="input" type="text" placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="modal-confirm-btn">
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
