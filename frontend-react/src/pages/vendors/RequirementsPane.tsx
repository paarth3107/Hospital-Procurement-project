import { Tag, type Tone } from "../../components/Tag";
import type { ItemRequirement } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorViewPage.js's requirementsPane().
const REQ_STATE: Record<string, [string, Tone]> = {
  missing: ["Not uploaded", "att"],
  pending: ["Uploaded — verify above", "esc"],
  verified: ["Verified", "pos"],
  rejected: ["Rejected", "neg"],
  expired: ["Expired", "neg"],
};
const REQ_SUMMARY: Record<string, [string, Tone]> = {
  documents_needed: ["Waiting on the vendor", "att"],
  awaiting_verification: ["Needs your verification", "esc"],
  verified: ["Eligible", "pos"],
};

export function RequirementsPane({ reqs }: { reqs: ItemRequirement[] }) {
  if (!reqs.length) return null;
  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Item Document Requirements</span>
        <span className="ep-k">verify uploaded documents above</span>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Item", "Held through", "Required documents", "Status"].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reqs.map((r) => {
            const [sl, st] = REQ_SUMMARY[r.summary];
            return (
              <tr key={r.product_id}>
                <td className="ep-cell fw-600">
                  {r.product_name}
                  <div className="ep-sub">
                    {r.product_code} · {r.category}
                  </div>
                </td>
                <td className="ep-cell ep-sub">{r.source === "category" ? "Via approved category" : `Item request (${r.mapping_state})`}</td>
                <td className="ep-cell">
                  {r.documents.map((d, i) => {
                    const [label, tone] = REQ_STATE[d.state];
                    return (
                      <div className="fs-12-5px" key={i}>
                        {d.label} <Tag text={label} tone={tone} />
                        {d.reason && <span className="ep-sub"> {d.reason}</span>}
                      </div>
                    );
                  })}
                </td>
                <td className="ep-cell">
                  <Tag text={sl} tone={st} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
