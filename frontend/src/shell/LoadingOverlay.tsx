import { useDelayedFetching } from "../lib/loadingStore";

// Comparison build, 2026-10-15 (user-directed): the "full dimmed overlay"
// option declined earlier in favor of LoadingBadge -- built anyway, hooked
// up in its place for now. TopLoadingBar/LoadingBadge are unhooked from
// App.tsx but left in place, not deleted, for the same reason. Blocks
// clicks on purpose (unlike the badge) -- that's the whole difference
// being tried out. User-directed: no white card around the spinner/text --
// they sit directly on the dimmed backdrop.
export function LoadingOverlay() {
  const visible = useDelayedFetching();
  if (!visible) return null;
  return (
    <div className="ep-loading-overlay" role="status" aria-label="Loading">
      <span className="ep-loading-spinner ep-loading-spinner-lg ep-loading-spinner-on-scrim" aria-hidden="true" />
      <span className="ep-loading-overlay-text">Loading…</span>
    </div>
  );
}
