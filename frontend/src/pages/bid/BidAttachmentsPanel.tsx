import { Tag } from "../../components/Tag";
import { UploadProgress } from "../../components/CircularProgress";
import type { BidAttachment, BidRequirements } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/bid/bidAttachments.js -- attachments
// for one line's bid (spec 8.3): one slot per document the line type
// calls for, mandatory ones flagged. Uploading needs a saved bid, so the
// caller passes `ensureBid()` which saves a draft first when none exists
// yet.
export function BidAttachmentsPanel({
  attachments,
  req,
  locked,
  busyKind,
  busyProgress = 0,
  onUpload,
  onRemove,
  onView,
}: {
  attachments: BidAttachment[];
  req: BidRequirements;
  locked: boolean;
  // Real bug, found 2026-10-13: nothing stopped clicking Upload again on a
  // slot already mid-upload (a (possibly large) file in flight), and
  // nothing showed anything was happening -- see BidLineItemsGrid.tsx's own
  // uploadAttachment().
  busyKind?: string | null;
  busyProgress?: number;
  onUpload: (kind: string) => void;
  onRemove: (attachmentId: number) => void;
  onView: (attachmentId: number, filename: string) => void;
}) {
  return (
    <div className="d-flex flex-col gap-12px">
      {req.slots.map((s) => {
        const mine = attachments.filter((f) => f.kind === s.kind);
        const busy = busyKind === s.kind;
        return (
          <div data-slot={s.kind} className="pb-10px border-bottom-1px-solid-ink-15" key={s.kind}>
            <div className="d-flex items-center gap-10px flex-wrap">
              <span className="fw-600">{s.label}</span>
              <span data-mandatory-tag="">{s.mandatory ? <Tag text={mine.length ? "provided" : "required"} tone={mine.length ? "pos" : "att"} /> : <span className="ep-sub">optional</span>}</span>
              {!locked && (
                <button type="button" className="ep-b ml-auto" disabled={busy} onClick={() => onUpload(s.kind)}>
                  {busy ? <UploadProgress value={busyProgress} /> : "Upload"}
                </button>
              )}
            </div>
            {mine.map((f) => (
              <div className="d-flex gap-10px items-center mt-6px fs-12-5px" key={f.id}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onView(f.id, f.original_filename);
                  }}
                >
                  {f.original_filename}
                </a>
                <span className="ep-sub">
                  {(f.size_bytes / 1024).toFixed(0)} KB{f.description ? " · " + f.description : ""}
                </span>
                {!locked && (
                  <button type="button" className="ep-b padding-0-8px" aria-label="Remove" onClick={() => onRemove(f.id)}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
