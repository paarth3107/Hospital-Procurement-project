import { useState } from "react";
import { createPortal } from "react-dom";

// React equivalent of frontend/js/modal.js's modalChoose() -- a message plus
// a <select> of named options, resolving to the chosen value or null on
// cancel. Used by Category Form's "items with their own minimum rating
// should follow the category instead?" decision.
export function ChooseDialog({
  title = "Choose One",
  message,
  options,
  onSubmit,
  onCancel,
}: {
  title?: string;
  message: string;
  options: { value: string; label: string }[];
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(options[0]?.value ?? "");

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>{title}</h3>
        <p id="modal-message">{message}</p>
        <div id="modal-body">
          <select className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus>
            {options.map((o) => (
              <option value={o.value} key={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="modal-confirm-btn" onClick={() => onSubmit(value)}>
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
