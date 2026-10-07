import { esc, tag } from "../../kit.js";

// ---- Tender line-item attachments (spec §6.4): SOW document (Service,
// mandatory), technical spec sheet (Asset), engineering drawing, reference/
// sample image, plus a free-label "Other" slot. Mirrors bid/bidAttachments.js's
// shape exactly -- same slots-with-a-mandatory-flag pattern, different
// endpoint (a tender line, not a vendor's bid). ----
export const KIND_LABELS = {
  sow_document: "Scope of Work (SOW) document",
  technical_spec_sheet: "Technical specification sheet",
  engineering_drawing: "Engineering drawing",
  reference_image: "Reference / sample image",
  other: "Other",
};

// [kind, mandatory]. Service's SOW is mandatory (spec §6.3.5/§6.4.1); Asset's
// technical spec sheet is spec'd as mandatory above a configured line value,
// not enforced yet (no such threshold config exists), so it stays optional here.
const SLOTS_BY_TYPE = {
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

export function attachmentsHtml(attachments, procurementType) {
  const slots = SLOTS_BY_TYPE[procurementType] || [];
  return slots
    .map(([kind, mandatory]) => {
      const mine = (attachments || []).filter((a) => a.kind === kind);
      return `<div data-slot="${kind}" class="pb-8px border-bottom-1px-solid-ink-15">
        <div class="d-flex items-center gap-10px flex-wrap">
          <span class="fw-600 fs-12-5px">${KIND_LABELS[kind]}</span>
          ${mandatory ? tag(mine.length ? "provided" : "required", mine.length ? "pos" : "att") : '<span class="ep-sub">optional</span>'}
          <button type="button" class="ep-b li-att-upload ml-auto padding-2px-8px" data-upload="${kind}">Upload</button>
        </div>
        ${mine
          .map(
            (f) => `<div class="d-flex gap-10px items-center mt-5px fs-12px">
              <a href="#" class="li-att-view" data-view-att="${f.id}">${esc(f.original_filename)}</a>
              <span class="ep-sub">${(f.size_bytes / 1024).toFixed(0)} KB${f.custom_label ? " · " + esc(f.custom_label) : ""}</span>
              <button type="button" class="ep-b li-att-remove padding-0-8px" data-remove-att="${f.id}" aria-label="Remove">×</button>
            </div>`
          )
          .join("")}
      </div>`;
    })
    .join("");
}
