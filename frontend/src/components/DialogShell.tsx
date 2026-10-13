import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// Shared shell for every form dialog this migration ports (first used by
// Staff Accounts' three dialogs) -- same pattern as AuditDetailDialog: its
// own portal into document.body, never the vanilla app's shared
// #app-dialog/#app-dialog-box nodes, so React never has to share DOM
// ownership with innerHTML-based code. Same .dialog-overlay/.dialog-box/
// .dlg-head CSS as the vanilla modal system, for visual parity.
export function DialogShell({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return createPortal(
    <div className="dialog-overlay">
      <div className="dialog-box">
        <div className="dlg-head">
          <div className="flex-1">
            <div className="ep-k">{kicker}</div>
            <h4>{title}</h4>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
