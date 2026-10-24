import { ExpiryTag, StateTag, Tag } from "../../components/Tag";
import { fmtDate } from "../../lib/format";
import { VENDOR_DOC_TYPES } from "../../lib/constants";
import type { VendorDocument } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorViewPage.js's docsPane(). Verify/
// Reject stay disabled until the reviewer has opened the file in this
// review session, so nobody rubber-stamps an unseen document. Verify drops
// off once a document is already verified or rejected (nothing left to
// verify); Reject stays visible either way but is greyed out once the
// document is already rejected (nothing to reject twice) -- it stays
// clickable on a verified document, since a reviewer finding a problem
// after verifying is a real case.
export function DocsPane({
  docs,
  reviewedDocIds,
  onViewDoc,
  onVerify,
  onReject,
  onViewReason,
}: {
  docs: VendorDocument[];
  reviewedDocIds: Set<number>;
  onViewDoc: (docId: number, filename: string) => void;
  onVerify: (docId: number) => void;
  onReject: (docId: number) => void;
  onViewReason: (reason: string) => void;
}) {
  const byType = new Map(docs.filter((d) => d.doc_type !== "other").map((d) => [d.doc_type, d]));
  const slots = [
    ...VENDOR_DOC_TYPES.map((t) => ({ label: t.label, mandatory: t.mandatory, doc: byType.get(t.value), other: false })),
    ...docs.filter((d) => d.doc_type === "other").map((d) => ({ label: d.custom_label, mandatory: false, doc: d, other: true })),
  ];

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>KYC &amp; Statutory Documents</span>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Document", "File", "Uploaded", "Valid till", "Verification", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map(({ label, mandatory, doc: d, other }, i) => {
            if (!d) {
              return (
                <tr key={i}>
                  <td className="ep-cell fw-600">
                    {label}
                    {!mandatory && <span className="ep-sub"> (optional)</span>}
                  </td>
                  <td className="ep-cell ep-sub" colSpan={3}>
                    Not uploaded
                  </td>
                  <td className="ep-cell text-center">
                    <Tag text="Missing" tone={mandatory ? "att" : ""} />
                  </td>
                  <td className="ep-cell"></td>
                </tr>
              );
            }
            const viewed = reviewedDocIds.has(d.id);
            return (
              <tr key={d.id}>
                <td className="ep-cell fw-600">
                  {label}
                  {other && <div className="ep-sub">Other — asked for by a catalog entry; read the name and verify</div>}
                </td>
                <td className="ep-cell ep-mono fs-12px">
                  {d.original_filename}
                  <div className="ep-sub">
                    {(d.size_bytes / 1024).toFixed(0)} KB ·{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        onViewDoc(d.id, d.original_filename);
                      }}
                    >
                      View
                    </a>
                  </div>
                </td>
                <td className="ep-cell fs-12-5px">{fmtDate(d.uploaded_at)}</td>
                <td className="ep-cell fs-12-5px">
                  {d.valid_till ? (
                    <>
                      {fmtDate(d.valid_till)}
                      <div>
                        <ExpiryTag expiryState={d.expiry_state} validTill={d.valid_till} />
                      </div>
                    </>
                  ) : (
                    <span className="ep-sub">—</span>
                  )}
                </td>
                <td className="ep-cell text-center">
                  <StateTag state={d.status} />
                  {/* One-line preview + "View reason" link (real bug, found
                      2026-10-24): this used to render the full reason inline
                      with no limit -- a 300-character reason took five lines
                      in this cell, next to every other column's single
                      line. */}
                  {d.status === "rejected" && d.rejection_reason && (
                    <div className="ep-sub text-danger-700 mt-3px d-flex items-center gap-6px">
                      <div className="ep-clip maxw-140px" title={d.rejection_reason}>
                        {d.rejection_reason}
                      </div>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onViewReason(d.rejection_reason!);
                        }}
                      >
                        View reason
                      </a>
                    </div>
                  )}
                </td>
                <td className="ep-cell text-center">
                  {d.status !== "verified" && d.status !== "rejected" && (
                    <button className="ep-b" data-v="p" disabled={!viewed} onClick={() => onVerify(d.id)}>
                      Verify
                    </button>
                  )}{" "}
                  <button className="ep-b" disabled={!viewed || d.status === "rejected"} onClick={() => onReject(d.id)}>
                    Reject
                  </button>
                  {!viewed && <div className="ep-sub">View before deciding</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
