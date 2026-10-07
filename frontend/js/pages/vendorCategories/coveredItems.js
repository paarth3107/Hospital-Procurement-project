import { esc, tag } from "../../kit.js";

// "Documents required for your items": every item the vendor holds (through an
// approved category or their own request) whose catalog entry asks for
// documents, with what is still missing, awaiting the Category Manager's
// verification, rejected or expired. Driven by GET /vendor-portal/documents/requirements
// (computed live, so a requirement added to an item later appears here even
// when the whole category is already approved). The vendor cannot be invited to
// an item until all its documents are Verified.
const STATE = {
  missing: ["Not uploaded", "att"],
  pending: ["Awaiting verification", "esc"],
  verified: ["Verified", "pos"],
  rejected: ["Rejected", "neg"],
  expired: ["Expired", "neg"],
};
const SUMMARY = {
  documents_needed: "Documents needed from you",
  awaiting_verification: "Waiting for the Category Manager to verify",
  verified: "All documents verified — eligible",
};

export function renderItemRequirements(requirements) {
  const open = requirements.filter((r) => r.summary !== "verified");
  const done = requirements.length - open.length;
  if (!open.length) {
    return done
      ? `<div class="hint mt-14px pt-12px border-top-1px-solid-ink-25">Documents for your items: all ${done} item(s) fully verified.</div>`
      : "";
  }
  return `<div class="mt-14px pt-12px border-top-1px-solid-ink-25">
    <div class="ep-k">Documents required for your items</div>
    <div class="hint mt-4px">An item can add new document requirements at any time, even when its whole category is already approved. You can be invited to bid on an item only once every document it requires is uploaded and verified.</div>
    ${open
      .map(
        (r) => `<div class="mt-12px padding-10px-12px border-1px-solid-ink-22">
        <div class="d-flex gap-10px items-center flex-wrap"><span class="fw-700">${esc(r.product_name)}</span><span class="ep-sub">${esc(r.product_code)} · ${esc(r.category)}${r.source === "item" && r.mapping_state === "pending" ? " · item request pending" : ""}</span>
          <span class="ml-auto">${tag(SUMMARY[r.summary], r.summary === "documents_needed" ? "att" : "esc")}</span></div>
        ${r.documents
          .map((d) => {
            const [label, tone] = STATE[d.state];
            const canUpload = ["missing", "rejected", "expired"].includes(d.state);
            return `<div class="d-flex gap-10px items-center mt-6px fs-13px flex-wrap">
              <span class="fw-600 minw-200px">${esc(d.label)}</span>${tag(label, tone)}
              ${d.reason ? `<span class="ep-sub text-danger-700">${esc(d.reason)}</span>` : ""}
              ${canUpload ? `<button type="button" class="ep-b ml-auto padding-1px-10px" data-upload-req="${esc(d.entry)}">${d.state === "missing" ? "Upload" : "Upload again"}</button>` : ""}</div>`;
          })
          .join("")}</div>`
      )
      .join("")}
  </div>`;
}
