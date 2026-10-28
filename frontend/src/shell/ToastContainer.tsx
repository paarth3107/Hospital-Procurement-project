import { Icon } from "../lib/icons";
import { dismissToast, useToasts } from "../lib/toastStore";

// Mounted once at the app root (App.tsx, alongside LoadingOverlay/AuthBoot),
// same convention as every other global singleton in the shell. Fixed
// top-right (2026-10-27, user-directed), stacked newest-last, never covers
// the buttons/table underneath -- it's a floating strip, not an overlay.
export function ToastContainer() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="ep-toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`ep-toast ep-toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <Icon name={t.kind === "success" ? "check-circle" : "shield"} size={18} className="ep-toast-icon" />
          <span className="ep-toast-message">{t.message}</span>
          {t.kind === "error" && (
            <button type="button" className="ep-toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
