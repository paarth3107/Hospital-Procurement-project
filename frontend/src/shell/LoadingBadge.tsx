import { useDelayedFetching } from "../lib/loadingStore";

// User-directed, 2026-10-15: the thin TopLoadingBar was "barely noticeable" --
// this is the more explicit signal, a small non-blocking badge bottom-right
// with a spinner and the word "Loading…", that appears/disappears with the
// exact same timing (useDelayedFetching) so the two never disagree.
export function LoadingBadge() {
  const visible = useDelayedFetching();
  if (!visible) return null;
  return (
    <div className="ep-loading-badge" role="status" aria-label="Loading">
      <span className="ep-loading-spinner" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}
