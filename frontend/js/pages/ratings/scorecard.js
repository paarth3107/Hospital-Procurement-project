import { esc, kicker, fmtDate } from "../../kit.js";

// One vendor's scorecard, as in the prototype: name + code, big composite
// score with its tier, the five weighted parameters as bars, an
// interpretation line, and (Procurement Admin only) a Manual adjustment button.
const PARAMS = [
  ["On-time delivery", "on_time_pct"],
  ["Quality acceptance", "quality_pct"],
  ["Price competitiveness", "price_competitiveness"],
  ["Compliance currency", "compliance_pct"],
  ["Responsiveness", "responsiveness"],
];

export const WEIGHTS = [
  ["25%", "On-time delivery", 25],
  ["25%", "Quality acceptance", 25],
  ["20%", "Price competitiveness", 20],
  ["15%", "Compliance currency", 15],
  ["15%", "Responsiveness", 15],
];

function tierOf(rating) {
  if (!rating) return "Unrated";
  if (rating.is_provisional) return "Provisional";
  if (rating.overall_score >= 85) return "Preferred";
  if (rating.overall_score >= 75) return "Qualified";
  return "Watch";
}

function noteOf(rating) {
  if (!rating) return "No rating yet in this type — it starts as a provisional score once a manual entry is saved.";
  if (rating.is_stale) return `Stale — manual update due (last entry ${fmtDate(rating.last_manual_update_at)}).`;
  if (rating.is_provisional) return "Provisional score: some manual parameters haven't been entered yet, so the composite re-weights what exists.";
  return `Last manual update ${fmtDate(rating.last_manual_update_at)}. Price competitiveness is system-computed.`;
}

export function scorecardHtml(vendor, rating, type, canAdjust) {
  const score = rating ? rating.overall_score.toFixed(0) : "NR";
  const scoreColor = !rating ? "rgba(32,30,29,.45)" : rating.overall_score >= 75 ? "#ec3013" : "#201e1d";
  return `<div class="ep-pane" style="padding:15px 16px;display:flex;flex-direction:column;gap:11px">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <div style="flex:1"><div style="font-size:14.5px;font-weight:800;line-height:1.2">${esc(vendor.legal_name)}</div>${kicker(`V-${vendor.id} · ${type}`)}</div>
      <div style="text-align:right"><div style="font-size:30px;font-weight:800;line-height:1;color:${scoreColor}">${score}</div>${kicker(tierOf(rating))}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${PARAMS.map(([label, field]) => {
      const v = rating ? rating[field] : null;
      const has = v !== null && v !== undefined;
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:rgba(32,30,29,.68)">${label}</span><span style="font-weight:600">${has ? Math.round(v) + "%" : "n/a"}</span></div>
        <div class="ep-bar" style="height:5px;margin-top:3px"><div style="width:${has ? v : 0}%;background:${has && v >= 75 ? "#ec3013" : "rgba(32,30,29,.5)"}"></div></div>
      </div>`;
    }).join("")}</div>
    <div style="font-size:11.5px;color:rgba(32,30,29,.6);line-height:1.4">${esc(noteOf(rating))}</div>
    ${canAdjust ? `<button class="ep-b" style="align-self:flex-start" data-adjust="${vendor.id}">Manual adjustment</button>` : ""}
  </div>`;
}
