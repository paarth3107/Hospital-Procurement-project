import { Tag } from "../../components/Tag";
import { UploadProgress } from "../../components/CircularProgress";
import type { LineAttachment, ProcurementType, TenderLineAttachmentKind } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/lineAttachments.js (spec §6.4):
// SOW document (Service, mandatory), technical spec sheet (Asset),
// engineering drawing, reference/sample image, plus a free-label "Other"
// slot. Mirrors bid/bidAttachments.js's shape exactly -- same
// slots-with-a-mandatory-flag pattern, different endpoint (a tender line,
// not a vendor's bid).
// Exported (2026-10-10, Phase 10d) -- BidLineItemsGrid.tsx reads a tender
// line's spec attachments' kind labels from here too, same as the vanilla
// bidLineItems.js importing `KIND_LABELS as SPEC_ATTACHMENT_KIND_LABELS`
// from this same file's vanilla counterpart (tenders/lineAttachments.js).
export const KIND_LABELS: Record<TenderLineAttachmentKind, string> = {
  sow_document: "Scope of Work (SOW) document",
  technical_spec_sheet: "Technical specification sheet",
  engineering_drawing: "Engineering drawing",
  reference_image: "Reference / sample image",
  other: "Other",
};

// [kind, mandatory]. Service's SOW is mandatory (spec §6.3.5/§6.4.1); Asset's
// technical spec sheet is spec'd as mandatory above a configured line value,
// not enforced yet (no such threshold config exists), so it stays optional here.
const SLOTS_BY_TYPE: Record<ProcurementType, [TenderLineAttachmentKind, boolean][]> = {
  item: [
    ["technical_spec_sheet", false],
    ["reference_image", false],
    ["other", false],
  ],
  asset: [
    ["technical_spec_sheet", false],
    ["engineering_drawing", false],
    ["reference_image", false],
    ["other", false],
  ],
  service: [
    ["sow_document", true],
    ["other", false],
  ],
};

export function AttachmentsPanel({
  attachments,
  procurementType,
  busyKind,
  busyProgress = 0,
  onUpload,
  onRemove,
  onView,
}: {
  attachments: LineAttachment[];
  procurementType: ProcurementType;
  // Real bug, found 2026-10-13: nothing stopped clicking Upload again on a
  // slot already mid-upload (a (possibly large) file in flight), and
  // nothing showed anything was happening -- see LineItemsGrid.tsx's/
  // BidLineItemsGrid.tsx's own uploadAttachment().
  busyKind?: TenderLineAttachmentKind | null;
  busyProgress?: number;
  onUpload: (kind: TenderLineAttachmentKind) => void;
  onRemove: (attachmentId: number) => void;
  onView: (attachmentId: number) => void;
}) {
  const slots = SLOTS_BY_TYPE[procurementType] || [];
  return (
    <>
      {slots.map(([kind, mandatory]) => {
        const mine = attachments.filter((a) => a.kind === kind);
        const busy = busyKind === kind;
        return (
          <div className="pb-8px border-bottom-1px-solid-ink-15" key={kind}>
            <div className="d-flex items-center gap-10px flex-wrap">
              <span className="fw-600 fs-12-5px">{KIND_LABELS[kind]}</span>
              {mandatory ? <Tag text={mine.length ? "provided" : "required"} tone={mine.length ? "pos" : "att"} /> : <span className="ep-sub">optional</span>}
              <button type="button" className="ep-b li-att-upload ml-auto padding-2px-8px" disabled={busy} onClick={() => onUpload(kind)}>
                {busy ? <UploadProgress value={busyProgress} /> : "Upload"}
              </button>
            </div>
            {mine.map((f) => (
              <div className="d-flex gap-10px items-center mt-5px fs-12px" key={f.id}>
                <a
                  href="#"
                  className="li-att-view"
                  onClick={(e) => {
                    e.preventDefault();
                    onView(f.id);
                  }}
                >
                  {f.original_filename}
                </a>
                <span className="ep-sub">
                  {(f.size_bytes / 1024).toFixed(0)} KB{f.custom_label ? ` · ${f.custom_label}` : ""}
                </span>
                <button type="button" className="ep-b li-att-remove padding-0-8px" aria-label="Remove" onClick={() => onRemove(f.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
