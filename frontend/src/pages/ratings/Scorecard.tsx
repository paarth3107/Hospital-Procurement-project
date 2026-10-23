import type { CSSProperties } from "react";
import { fmtDate } from "../../lib/format";
import type { ProcurementType, Rating, VendorLookup } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/ratings/scorecard.js.
const PARAMS: [string, keyof Rating][] = [
  ["On-time delivery", "on_time_pct"],
  ["Quality acceptance", "quality_pct"],
  ["Price competitiveness", "price_competitiveness"],
  ["Compliance currency", "compliance_pct"],
  ["Responsiveness", "responsiveness"],
];

export const WEIGHTS: [string, string, number][] = [
  ["25%", "On-time delivery", 25],
  ["25%", "Quality acceptance", 25],
  ["20%", "Price competitiveness", 20],
  ["15%", "Compliance currency", 15],
  ["15%", "Responsiveness", 15],
];

// No separate "Provisional" tier (2026-10-23, user-directed, matching spec
// exactly) -- a vendor is either Unrated, or rated on whatever real data
// currently exists, re-weighted the same way it's always been.
function tierOf(rating: Rating | undefined): string {
  if (!rating || rating.is_unrated) return "Unrated";
  if (rating.overall_score >= 85) return "Preferred";
  if (rating.overall_score >= 75) return "Qualified";
  return "Watch";
}

function noteOf(rating: Rating | undefined): string {
  if (!rating || rating.is_unrated) return "No history yet — nothing to rate. Can still be added to a tender manually if needed.";
  if (rating.is_stale) return `Stale — manual update due (last entry ${fmtDate(rating.last_manual_update_at)}).`;
  return `Last manual update ${fmtDate(rating.last_manual_update_at)}. Price competitiveness is system-computed.`;
}

export function Scorecard({
  vendor,
  rating,
  type,
  canAdjust,
  onAdjust,
}: {
  vendor: VendorLookup;
  rating: Rating | undefined;
  type: ProcurementType;
  canAdjust: boolean;
  onAdjust: () => void;
}) {
  const score = rating && !rating.is_unrated ? rating.overall_score.toFixed(0) : "NR";
  const scoreColorClass = !rating || rating.is_unrated ? "score-color-none" : rating.overall_score >= 75 ? "score-color-good" : "score-color-mid";
  return (
    <div className="ep-pane padding-15px-16px d-flex flex-col gap-11px">
      <div className="d-flex items-start gap-10px">
        <div className="flex-1">
          <div className="fs-14-5px fw-800 lh-1-2">{vendor.legal_name}</div>
          <div className="ep-k">
            V-{vendor.id} · {type}
          </div>
        </div>
        <div className="text-right">
          <div className={`fs-30px fw-800 lh-1 ${scoreColorClass}`}>{score}</div>
          <div className="ep-k">{tierOf(rating)}</div>
        </div>
      </div>
      <div className="d-flex flex-col gap-6px">
        {PARAMS.map(([label, field]) => {
          const v = rating ? (rating[field] as number | null) : null;
          const has = v !== null && v !== undefined;
          return (
            <div key={field}>
              <div className="d-flex justify-between fs-11-5px">
                <span className="text-ink-68">{label}</span>
                <span className="fw-600">{has ? Math.round(v as number) + "%" : "n/a"}</span>
              </div>
              <div className={`ep-bar h-5px mt-3px ${has && (v as number) >= 75 ? "bar-good" : "bar-mid"}`}>
                <div style={{ "--bar-w": `${has ? v : 0}%` } as CSSProperties} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="fs-11-5px text-ink-60 lh-1-4">{noteOf(rating)}</div>
      {canAdjust && (
        <button className="ep-b self-start" onClick={onAdjust}>
          Manual adjustment
        </button>
      )}
    </div>
  );
}
