import { esc, tag, th, inr } from "../../kit.js";

// Shared bits of the L1 award screens.
export const STATE = {
  none: ["Not recommended yet", "att"],
  draft: ["Draft recommendation", "esc"],
  pending: ["Waiting for L1 approval", "att"],
  approved: ["Approved", "pos"],
  excluded: ["Left out of the award", "neg"],
  returned: ["Returned by approver", "neg"],
};

export const DECISION_LABEL = {
  approved_recommendation: "Approved the recommendation",
  awarded_system_l1: "Awarded to the system's L1/C1 instead",
  approved_adjusted: "Approved with an adjusted split",
  rejected: "Rejected",
};

export const qualifiedRows = (line) => (line.statement || []).filter((r) => r.rank != null);
export const topRow = (line) => qualifiedRows(line)[0];

const allocText = (allocs) => allocs.map((a) => `${esc(a.vendor_name)} — ${a.share_pct}% (${a.quantity} units)`).join("<br>");
export const allocationsHtml = (allocs) => (allocs.length ? allocText(allocs) : "—");

// The comparative statement of one line: technical standing and prices side by
// side. The system's top-ranked bid, the Officer's pick and the final award are marked.
export function statementHtml(line) {
  if (!line.statement) return "";
  const cur = line.current;
  const proposed = new Set((cur?.proposed || []).map((a) => a.bid_id));
  const final = new Set((cur?.final || []).map((a) => a.bid_id));
  const qcbs = line.method === "QCBS";
  const rows = line.statement
    .map((r) => {
      const off = r.rank == null;
      const marks = [
        r.recommended ? tag("System's " + r.rank_label, "pos") : "",
        proposed.has(r.bid_id) ? tag("Officer's pick", "esc") : "",
        final.has(r.bid_id) ? tag("Awarded", "pos") : "",
      ].join(" ");
      return `<tr>
        <td class="ep-cell">${off ? tag("Disqualified", "neg") : `<span style="font-weight:800">${esc(r.rank_label)}</span>`}<div style="margin-top:3px">${marks}</div></td>
        <td class="ep-cell"><div style="font-weight:600">${esc(r.vendor_name)}</div><div class="ep-sub">rating ${r.rating}</div></td>
        <td class="ep-cell" style="font-size:12.5px">${off ? esc(r.technical_reason || "") : r.technical_score != null ? `${r.technical_score} / 100${r.t_rank ? ` · T${r.t_rank}` : ""}` : "qualified"}</td>
        <td class="ep-cell">${off ? '<span class="ep-sub">Price not opened</span>' : `<div style="font-weight:700">${inr(r.unit_price)}</div><div class="ep-sub">+${r.gst_percent ?? 0}% GST</div>`}</td>
        <td class="ep-cell">${off ? "" : `<div style="font-weight:700">${inr(r.landed_unit_price)}</div><div class="ep-sub">total ${inr(r.landed_total)}</div>`}</td>
        ${qcbs ? `<td class="ep-cell" style="font-size:12.5px">${off ? "" : `combined <b>${r.combined_score ?? "—"}</b>`}</td>` : ""}
        <td class="ep-cell" style="font-size:12.5px">${off ? "" : `${r.delivery_lead_days ?? "—"} days${r.payment_terms ? `<div class="ep-sub">${esc(r.payment_terms)}</div>` : ""}${r.price_flags.map((f) => `<div style="color:#ae1800">${esc(f)}</div>`).join("")}`}</td>
      </tr>`;
    })
    .join("");
  return `<table class="ep-table" style="margin-top:8px">${th("Rank", "Vendor", "Technical", "Quoted price", "Landed price", ...(qcbs ? ["QCBS"] : []), "Delivery / checks")}<tbody>${rows}</tbody></table>`;
}
