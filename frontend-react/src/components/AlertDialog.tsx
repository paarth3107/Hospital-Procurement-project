import { createPortal } from "react-dom";

// React equivalent of frontend/js/modal.js's modalAlert() -- same .modal-box
// CSS, own portal. Only an OK button (no Cancel), matching openModal()'s
// `cancelBtn.hidden = type === "alert"`.
export function AlertDialog({ title = "Notice", message, onClose }: { title?: string; message: string; onClose: () => void }) {
  return createPortal(
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>{title}</h3>
        <p id="modal-message">{message}</p>
        <div className="modal-actions">
          <button type="button" className="modal-confirm-btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
