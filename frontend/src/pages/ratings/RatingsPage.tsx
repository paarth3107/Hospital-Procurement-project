import { useEffect, useState, type CSSProperties } from "react";
import { useAuthState } from "../../lib/authStore";
import { loadCatalogData, patchCachedRating } from "../../lib/catalogCache";
import type { ProcurementType, Rating, VendorLookup } from "../../lib/types";
import { Scorecard, WEIGHTS } from "./Scorecard";
import { AdjustRatingDialog } from "./AdjustRatingDialog";

// Ported 1:1 from frontend/js/pages/ratings/ratingsPage.js -- Phase 1 of the
// React migration (see .claude-notes/REACT-MIGRATION-PLAN.md).

const TYPES: [ProcurementType, string][] = [
  ["item", "Items"],
  ["asset", "Assets"],
  ["service", "Services"],
];

function WeightStrip() {
  return (
    <div className="ep-pane padding-16px-18px d-flex gap-26px items-center">
      <div className="flex-none">
        <div className="ep-k">Weighted model</div>
        <div className="fs-13px fw-800 mt-3px">Price competitiveness is system-computed · the rest entered by Procurement Admin</div>
      </div>
      <div className="flex-1 d-flex gap-1px bg-ink-30">
        {WEIGHTS.map(([pct, label, flex]) => (
          <div className="flex-var bg-page-bg padding-8px-10px" style={{ "--flex": flex } as CSSProperties} key={label}>
            <div className="fs-15px fw-800">{pct}</div>
            <div className="fs-10-5px lh-1-3 text-ink-65">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RatingsPage() {
  const [type, setType] = useState<ProcurementType>("item");
  const [vendors, setVendors] = useState<VendorLookup[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  // Real bug, found 2026-10-15: own redundant /auth/me fetch, same pattern
  // as DashboardPage -- the role is already in the shared auth store.
  const currentUser = useAuthState().user;
  const [adjusting, setAdjusting] = useState<VendorLookup | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Real bug, found 2026-10-15, user-reported via the browser's own network
  // panel: vendors and ratings were fetched here independently of
  // catalogCache.ts, which Mapping Matrix/Requests also read (both want the
  // same vendor list; mapping pages want ALL ratings, this page wants them
  // per type) -- navigating between this page and either mapping page
  // re-fetched the same data twice over. Reads the shared cache instead
  // (fetched once per session), and filters by type in the render below
  // rather than re-fetching per tab -- the vendor list doesn't even depend
  // on type at all, only the rating does.
  useEffect(() => {
    loadCatalogData()
      .then((d) => {
        setVendors(d.vendors);
        setRatings(d.ratings);
      })
      .catch((err) => setMessage({ text: "Could not load ratings: " + (err instanceof Error ? err.message : String(err)), ok: false }));
  }, []);

  const ratingByVendor = new Map(ratings.filter((r) => r.procurement_type === type).map((r) => [r.vendor_id, r]));

  const canAdjust = currentUser ? ["procurement_admin", "category_manager"].includes(currentUser.role) : false;

  return (
    <div className="d-flex flex-col gap-18px">
      <div className="d-flex items-center gap-14px flex-wrap">
        <div className="ep-seg">
          {TYPES.map(([k, l]) => (
            <button className={k === type ? "on" : ""} onClick={() => setType(k)} key={k}>
              {l}
            </button>
          ))}
        </div>
        <div className="hint">A vendor holds a separate rating for each procurement type — strong at Items doesn't make them strong at Services.</div>
      </div>
      <WeightStrip />
      <div className="d-grid grid-cols-repeat31fr gap-16px">
        {vendors.length === 0 ? (
          <div className="ep-pane ep-pane-pad hint">No vendors to rate yet.</div>
        ) : (
          vendors.map((v) => (
            <Scorecard vendor={v} rating={ratingByVendor.get(v.id)} type={type} canAdjust={canAdjust} onAdjust={() => setAdjusting(v)} key={v.id} />
          ))
        )}
      </div>
      {message && <div className={`result ${message.ok ? "ok" : "err"}`}>{message.text}</div>}
      {adjusting && (
        <AdjustRatingDialog
          vendor={adjusting}
          type={type}
          rating={ratingByVendor.get(adjusting.id)}
          onClose={() => setAdjusting(null)}
          onSaved={(msg, updated) => {
            setMessage({ text: msg, ok: true });
            // Keeps the shared cache (catalogCache.ts) correct too, not
            // just this page's own copy -- same reasoning as
            // useMappingActions.ts's patchCachedMapping.
            patchCachedRating(updated);
            setRatings((prev) => (prev.some((r) => r.id === updated.id) ? prev.map((r) => (r.id === updated.id ? updated : r)) : [...prev, updated]));
          }}
        />
      )}
    </div>
  );
}
