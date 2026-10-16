import { useDelayedFetching } from "../lib/loadingStore";

// A thin bar across the very top of the viewport, visible whenever any
// api() call (lib/api.ts) is in flight -- so a slow request looks visibly
// different from a broken page instead of just sitting there blank
// (2026-10-15, user-reported). Kept alongside the more explicit
// LoadingBadge (user-directed, same conversation): this one's an ambient
// hint, the badge is the clearer "it's loading" signal with actual text.
export function TopLoadingBar() {
  const visible = useDelayedFetching();
  if (!visible) return null;
  return <div className="ep-top-loading-bar" role="status" aria-label="Loading" />;
}
