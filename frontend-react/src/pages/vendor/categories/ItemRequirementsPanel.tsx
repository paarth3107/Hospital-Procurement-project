import { Tag } from "../../../components/Tag";
import type { ItemRequirement } from "../../../lib/types";
import { uploadRequirementDoc } from "./uploadRequirementDoc";

// Ported 1:1 from frontend/js/pages/vendorCategories/coveredItems.js --
// "Documents required for your items": every item the vendor holds
// (through an approved category or their own request) whose catalog entry
// asks for documents, with what is still missing, awaiting the Category
// Manager's verification, rejected or expired. Driven by
// GET /vendor-portal/documents/requirements (computed live, so a
// requirement added to an item later appears here even when the whole
// category is already approved). The vendor cannot be invited to an item
// until all its documents are Verified.
const STATE: Record<string, ["att" | "esc" | "pos" | "neg", string]> = {
  missing: ["att", "Not uploaded"],
  pending: ["esc", "Awaiting verification"],
  verified: ["pos", "Verified"],
  rejected: ["neg", "Rejected"],
  expired: ["neg", "Expired"],
};
const SUMMARY: Record<string, string> = {
  documents_needed: "Documents needed from you",
  awaiting_verification: "Waiting for the Category Manager to verify",
  verified: "All documents verified — eligible",
};

// Returns its own outer `ep-pane` wrapper (border-left-3px-solid-primary,
// matching the vanilla caller's conditional wrap around whatever
// renderItemRequirements() returned) whenever there's anything to show;
// null only when the vendor has no requirements at all yet.
export function ItemRequirementsPanel({ requirements, onUploaded, onError }: { requirements: ItemRequirement[]; onUploaded: () => void; onError: (message: string) => void }) {
  if (!requirements.length) return null;
  const open = requirements.filter((r) => r.summary !== "verified");
  const done = requirements.length - open.length;

  if (!open.length) {
    return <div className="ep-pane ep-pane-pad mb-18px border-left-3px-solid-primary">Documents for your items: all {done} item(s) fully verified.</div>;
  }

  return (
    <div className="ep-pane ep-pane-pad mb-18px border-left-3px-solid-primary">
      <div className="ep-k">Documents required for your items</div>
      <div className="hint mt-4px">
        An item can add new document requirements at any time, even when its whole category is already approved. You can be invited to bid on an item only once every document it
        requires is uploaded and verified.
      </div>
      {open.map((r) => (
        <div className="mt-12px padding-10px-12px border-1px-solid-ink-22" key={r.product_id}>
          <div className="d-flex gap-10px items-center flex-wrap">
            <span className="fw-700">{r.product_name}</span>
            <span className="ep-sub">
              {r.product_code} · {r.category}
              {r.source === "item" && r.mapping_state === "pending" ? " · item request pending" : ""}
            </span>
            <span className="ml-auto">
              <Tag text={SUMMARY[r.summary]} tone={r.summary === "documents_needed" ? "att" : "esc"} />
            </span>
          </div>
          {r.documents.map((d) => {
            const [tone, label] = STATE[d.state];
            const canUpload = ["missing", "rejected", "expired"].includes(d.state);
            return (
              <div className="d-flex gap-10px items-center mt-6px fs-13px flex-wrap" key={d.entry}>
                <span className="fw-600 minw-200px">{d.label}</span>
                <Tag text={label} tone={tone} />
                {d.reason && <span className="ep-sub text-danger-700">{d.reason}</span>}
                {canUpload && (
                  <button
                    type="button"
                    className="ep-b ml-auto padding-1px-10px"
                    onClick={() => uploadRequirementDoc(d.entry, d.entry.startsWith("other:"), d.entry.startsWith("other:") ? d.entry.slice(6).trim() : "", onUploaded, onError)}
                  >
                    {d.state === "missing" ? "Upload" : "Upload again"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
