import { inr } from "../../lib/format";
import { InviteSourceTag, Tag, type Tone } from "../../components/Tag";
import type { AllocationOut, AwardLine, CommercialRow } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/awards/awardHelpers.js -- shared bits
// of the L1 award screens.
export const STATE: Record<AwardLine["state"], [string, Tone]> = {
  none: ["Not recommended yet", "att"],
  draft: ["Draft recommendation", "esc"],
  pending: ["Waiting for L1 approval", "att"],
  approved: ["Approved", "pos"],
  excluded: ["Left out of the award", "neg"],
  returned: ["Returned by approver", "neg"],
};

export const DECISION_LABEL: Record<string, string> = {
  approved_recommendation: "Approved the recommendation",
  awarded_system_l1: "Awarded to the system's L1/C1 instead",
  approved_adjusted: "Approved with an adjusted split",
  rejected: "Rejected",
  auto_no_bids: "Closed automatically — no bids received",
};

export const qualifiedRows = (line: AwardLine): CommercialRow[] => (line.statement || []).filter((r) => r.rank != null);
export const topRow = (line: AwardLine): CommercialRow | undefined => qualifiedRows(line)[0];

export function Allocations({ allocs }: { allocs: AllocationOut[] }) {
  if (!allocs.length) return <>—</>;
  return (
    <>
      {allocs.map((a, i) => (
        <span key={a.bid_id}>
          {i > 0 && <br />}
          {a.vendor_name} — {a.share_pct}% ({a.quantity} units)
        </span>
      ))}
    </>
  );
}

// The comparative statement of one line: technical standing and prices side
// by side. The system's top-ranked bid, the Officer's pick and the final
// award are marked.
export function StatementTable({ line }: { line: AwardLine }) {
  if (!line.statement) return null;
  const cur = line.current;
  const proposed = new Set((cur?.proposed || []).map((a) => a.bid_id));
  const final = new Set((cur?.final || []).map((a) => a.bid_id));
  const qcbs = line.method === "QCBS";
  return (
    <table className="ep-table mt-8px">
      <thead>
        <tr>
          {["Rank", "Vendor", "Technical", "Quoted price", "Landed price", ...(qcbs ? ["QCBS"] : []), "Delivery / checks"].map((h) => (
            <th className="ep-th" key={h}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {line.statement.map((r) => {
          const off = r.rank == null;
          return (
            <tr key={r.bid_id}>
              <td className="ep-cell">
                {off ? <Tag text="Disqualified" tone="neg" /> : <span className="fw-800">{r.rank_label}</span>}
                <div className="mt-3px">
                  {r.recommended && <Tag text={"System's " + r.rank_label} tone="pos" />} {proposed.has(r.bid_id) && <Tag text="Officer's pick" tone="esc" />}{" "}
                  {final.has(r.bid_id) && <Tag text="Awarded" tone="pos" />}
                </div>
              </td>
              <td className="ep-cell">
                <div className="fw-600">{r.vendor_name}</div>
                <div className="ep-sub">rating {r.rating}</div>
                <div className="mt-3px">
                  <InviteSourceTag source={r.invite_source} reason={r.invite_reason} />
                </div>
              </td>
              <td className="ep-cell fs-12-5px">
                {off ? r.technical_reason || "" : r.technical_score != null ? `${r.technical_score} / 100${r.t_rank ? ` · T${r.t_rank}` : ""}` : "qualified"}
              </td>
              <td className="ep-cell">
                {off ? (
                  <span className="ep-sub">Price not opened</span>
                ) : (
                  <>
                    <div className="fw-700">{inr(r.unit_price)}</div>
                    <div className="ep-sub">+{r.gst_percent ?? 0}% GST</div>
                  </>
                )}
              </td>
              <td className="ep-cell">
                {!off && (
                  <>
                    <div className="fw-700">{inr(r.landed_unit_price)}</div>
                    <div className="ep-sub">total {inr(r.landed_total)}</div>
                  </>
                )}
              </td>
              {qcbs && <td className="ep-cell fs-12-5px">{!off && (<>combined <b>{r.combined_score ?? "—"}</b></>)}</td>}
              <td className="ep-cell fs-12-5px">
                {!off && (
                  <>
                    {r.delivery_lead_days ?? "—"} days
                    {r.payment_terms && <div className="ep-sub">{r.payment_terms}</div>}
                    {r.price_flags.map((f, i) => (
                      <div className="text-danger-700" key={i}>
                        {f}
                      </div>
                    ))}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
