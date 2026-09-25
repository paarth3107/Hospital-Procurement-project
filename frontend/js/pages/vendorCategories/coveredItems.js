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
      ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(32,30,29,.25)" class="hint">Documents for your items: all ${done} item(s) fully verified.</div>`
      : "";
  }
  return `<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(32,30,29,.25)">
    <div class="ep-k">Documents required for your items</div>
    <div class="hint" style="margin-top:4px">An item can add new document requirements at any time, even when its whole category is already approved. You can be invited to bid on an item only once every document it requires is uploaded and verified.</div>
    ${open
      .map(
        (r) => `<div style="margin-top:12px;padding:10px 12px;border:1px solid rgba(32,30,29,.22)">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-weight:700">${esc(r.product_name)}</span><span class="ep-sub">${esc(r.product_code)} · ${esc(r.category)}${r.source === "item" && r.mapping_state === "pending" ? " · item request pending" : ""}</span>
          <span style="margin-left:auto">${tag(SUMMARY[r.summary], r.summary === "documents_needed" ? "att" : "esc")}</span></div>
        ${r.documents
          .map((d) => {
            const [label, tone] = STATE[d.state];
            const canUpload = ["missing", "rejected", "expired"].includes(d.state);
            return `<div style="display:flex;gap:10px;align-items:center;margin-top:6px;font-size:13px;flex-wrap:wrap">
              <span style="font-weight:600;min-width:200px">${esc(d.label)}</span>${tag(label, tone)}
              ${d.reason ? `<span class="ep-sub" style="color:#ae1800">${esc(d.reason)}</span>` : ""}
              ${canUpload ? `<button type="button" class="ep-b" style="margin-left:auto;padding:1px 10px" data-upload-req="${esc(d.entry)}">${d.state === "missing" ? "Upload" : "Upload again"}</button>` : ""}</div>`;
          })
          .join("")}</div>`
      )
      .join("")}
  </div>`;
}
