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
  const scoreColorClass = !rating ? "score-color-none" : rating.overall_score >= 75 ? "score-color-good" : "score-color-mid";
  return `<div class="ep-pane padding-15px-16px d-flex flex-col gap-11px">
    <div class="d-flex items-start gap-10px">
      <div class="flex-1"><div class="fs-14-5px fw-800 lh-1-2">${esc(vendor.legal_name)}</div>${kicker(`V-${vendor.id} · ${type}`)}</div>
      <div class="text-right"><div class="fs-30px fw-800 lh-1 ${scoreColorClass}">${score}</div>${kicker(tierOf(rating))}</div>
    </div>
    <div class="d-flex flex-col gap-6px">${PARAMS.map(([label, field]) => {
      const v = rating ? rating[field] : null;
      const has = v !== null && v !== undefined;
      return `<div>
        <div class="d-flex justify-between fs-11-5px"><span class="text-ink-68">${label}</span><span class="fw-600">${has ? Math.round(v) + "%" : "n/a"}</span></div>
        <div class="ep-bar h-5px mt-3px ${has && v >= 75 ? "bar-good" : "bar-mid"}"><div style="--bar-w:${has ? v : 0}%"></div></div>
      </div>`;
    }).join("")}</div>
    <div class="fs-11-5px text-ink-60 lh-1-4">${esc(noteOf(rating))}</div>
    ${canAdjust ? `<button class="ep-b self-start" data-adjust="${vendor.id}">Manual adjustment</button>` : ""}
  </div>`;
}
