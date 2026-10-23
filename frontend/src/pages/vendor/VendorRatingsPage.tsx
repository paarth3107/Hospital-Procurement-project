import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api } from "../../lib/api";
import type { Rating, VendorDetail } from "../../lib/types";
import { Scorecard, WEIGHTS } from "../ratings/Scorecard";

// Split out of VendorDashboardPage.tsx (2026-10-23, user-directed): its own
// rating section, now a dedicated tab -- one scorecard per procurement
// type (Item/Asset/Service) this vendor has been rated in. Read-only, same
// as it always was on the Dashboard (canAdjust is staff-only, spec §5.3.1).

function WeightStrip() {
  return (
    <div className="ep-pane padding-16px-18px d-flex gap-26px items-center flex-wrap">
      <div className="flex-none">
        <div className="ep-k">Weighted model</div>
        <div className="fs-13px fw-800 mt-3px">Price competitiveness is system-computed · the rest entered by Category Manager</div>
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

export function VendorRatingsPage() {
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [v, r] = await Promise.all([api<VendorDetail>("/vendor-auth/me"), api<Rating[]>("/vendor-portal/ratings")]);
      setVendor(v);
      setRatings(r);
      setError("");
    } catch (err) {
      setError("Could not load ratings: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !vendor) return <div className="result err">{error}</div>;
  if (!vendor) return null;

  return (
    <div className="d-flex flex-col gap-18px">
      <WeightStrip />
      {!ratings.length ? (
        <div className="ep-pane ep-pane-pad">
          <div className="hint">You haven't been rated yet — this starts once you're approved for a category and begin supplying under it.</div>
        </div>
      ) : (
        <div className="ep-pane">
          <div className="ep-pane-head">
            <span>Your Rating</span>
            <span className="ep-k">one score per procurement type you're rated in</span>
          </div>
          <div className="padding-16px d-grid grid-cols-repeatauto-fitminmax260px1fr gap-14px">
            {ratings.map((r) => (
              <Scorecard vendor={vendor} rating={r} type={r.procurement_type} canAdjust={false} onAdjust={() => {}} key={r.id} />
            ))}
          </div>
        </div>
      )}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
