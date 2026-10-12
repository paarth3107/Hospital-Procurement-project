import { useState } from "react";
import { fmtDateTime } from "../../lib/format";
import type { VendorStatusHistoryEntry } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorViewPage.js's historyPane().
// Closed by default -- it's a record, not something that needs reviewing
// every time a vendor is opened.
export function HistoryPane({ history }: { history: VendorStatusHistoryEntry[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="d-flex">
        <button className="ep-b" onClick={() => setOpen(true)}>
          Show status history ({history.length})
        </button>
      </div>
    );
  }

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Status History</span>
        <button className="ep-b" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      <div className="padding-12px-14px d-flex flex-col gap-8px">
        {history
          .slice()
          .reverse()
          .map((h) => (
            <div className="hist" key={h.id}>
              <div className="hist-when">{fmtDateTime(h.at)}</div>
              <div className="fs-12px lh-1-4">
                {h.from_status ? h.from_status.replace("_", " ") + " → " : ""}
                <b>{h.to_status.replace("_", " ")}</b>
                {h.reason ? " — " + h.reason : ""}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
