import { useEffect, useState, useSyncExternalStore } from "react";

// User-reported, 2026-10-15: "half the time I'm sitting there thinking
// it's not working, meanwhile it's just slow" -- almost every page calls
// lib/api.ts's api() and renders nothing while it's in flight, so a slow
// request and a broken one look identical. Rather than adding a loading
// flag to every single page one at a time, this is a single shared counter
// api() itself increments/decrements around every call (see api.ts) -- any
// page doing its own extra fetch (uploadWithProgress, a raw fetch() for a
// file download) already shows its own dedicated progress UI, so those
// deliberately don't touch this counter too.
let count = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function beginFetch() {
  count++;
  if (count === 1) notify();
}

export function endFetch() {
  count = Math.max(0, count - 1);
  if (count === 0) notify();
}

function isLoading() {
  return count > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsFetching(): boolean {
  return useSyncExternalStore(subscribe, isLoading);
}

// Shared by every visible loading indicator (TopLoadingBar, LoadingBadge):
// true only once fetching has been going on for `delayMs` straight, so a
// normal fast request (the common case) never flashes anything at all --
// it only shows up once something's actually taking a moment.
export function useDelayedFetching(delayMs = 150): boolean {
  const fetching = useIsFetching();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!fetching) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [fetching, delayMs]);

  return visible;
}
