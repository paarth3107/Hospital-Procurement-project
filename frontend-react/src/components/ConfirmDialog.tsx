import { createPortal } from "react-dom";

// Shared across every future ported page -- the React equivalent of
// frontend/js/modal.js's modalConfirm(). Own portal, same .modal-box CSS,
// never touches the vanilla app's shared #modal-overlay node (that stays
// exclusively modal.js's, used by every still-unconverted page). Confirm
// button uses .modal-confirm-btn (the class equivalent of the vanilla's
// #modal-confirm-btn, added to styles.css for this).
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>{title}</h3>
        <p id="modal-message">{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`modal-confirm-btn${danger ? " danger" : ""}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
