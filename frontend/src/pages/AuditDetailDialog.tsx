import { createPortal } from "react-dom";
import type { AuditLogRow } from "../lib/types";
import { fmtDateTime, roleLabel, actionLabel, pretty } from "../lib/format";

// Ported from frontend/js/pages/audit/auditDetail.js. Deliberately does NOT
// reuse the vanilla app's shared #app-dialog/#app-dialog-box nodes -- those
// stay exclusively modal.js's (used by every still-unconverted page). This
// renders its own overlay via a portal, same CSS classes for visual parity,
// so React never has to share DOM ownership of a node with innerHTML-based
// code. Every future ported page with a dialog should follow this pattern.
export function AuditDetailDialog({ row, onClose }: { row: AuditLogRow; onClose: () => void }) {
  const who = row.actor_type === "system" ? "System" : `${row.actor_name || "—"}${row.actor_role ? ` (${roleLabel(row.actor_role)})` : ""}`;

  return createPortal(
    <div className="dialog-overlay">
      <div className="dialog-box">
        <div className="dlg-head">
          <div className="flex-1">
            <div className="ep-k">
              Audit entry #{row.id}
              {row.imported ? " · imported from earlier history" : ""}
            </div>
            <h4>{actionLabel(row.action)}</h4>
          </div>
        </div>
        <div className="padding-16px-18px d-flex flex-col gap-14px maxh-70vh overflow-auto">
          <div className="d-grid grid-cols-1fr-1fr gap-12px">
            <div>
              <div className="ep-k">When</div>
              <div className="fw-600 mt-3px">{fmtDateTime(row.occurred_at)}</div>
            </div>
            <div>
              <div className="ep-k">Who</div>
              <div className="fw-600 mt-3px">{who}</div>
            </div>
            <div>
              <div className="ep-k">Record</div>
              <div className="fw-600 mt-3px">
                {row.entity_type}
                {row.entity_id != null ? ` #${row.entity_id}` : ""}
                {row.entity_label ? ` — ${row.entity_label}` : ""}
              </div>
            </div>
            <div>
              <div className="ep-k">Facility</div>
              <div className="fw-600 mt-3px">{row.facility_id ?? "—"}</div>
            </div>
          </div>
          {row.reason && (
            <div>
              <div className="ep-k">Reason / comment</div>
              <div className="mt-3px pre-wrap">{row.reason}</div>
            </div>
          )}
          <div>
            <div className="ep-k">Before</div>
            <KvTable obj={row.before_state} />
          </div>
          <div>
            <div className="ep-k">After</div>
            <KvTable obj={row.after_state} />
          </div>
          {row.meta && (
            <div>
              <div className="ep-k">Context</div>
              <KvTable obj={row.meta} />
            </div>
          )}
        </div>
        <div className="padding-12px-18px d-flex justify-end">
          <button className="ep-b" data-v="p" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function KvTable({ obj }: { obj: Record<string, unknown> | null }) {
  if (!obj || !Object.keys(obj).length) return <div className="ep-sub mt-6px">—</div>;
  return (
    <table className="ep-table mt-6px">
      <tbody>
        {Object.entries(obj).map(([k, v]) => (
          <tr key={k}>
            <td className="ep-cell ep-sub w-34pct">{k.replace(/_/g, " ")}</td>
            <td className="ep-cell fs-12-5px pre-wrap break-word">{pretty(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
