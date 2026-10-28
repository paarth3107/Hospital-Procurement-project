import { useSyncExternalStore } from "react";

// App-wide toast notifications (2026-10-27, user-directed): every create/
// update/delete/status action should leave a clear, consistent trace --
// "it worked" or "it didn't, and why" -- instead of either nothing at all
// or an inline <div className="result ..."> banner that scrolls out of
// view with the rest of the page. Same external-store pattern as
// chromeStore.ts/loadingStore.ts (a plain module-level array, not React
// state, so any non-component code -- api.ts included -- can push a toast
// without needing a hook).
export type ToastKind = "success" | "error";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

// Success toasts clear themselves; error toasts stay until the user
// dismisses them (2026-10-27, user-directed -- a failure shouldn't vanish
// before it's been read).
const SUCCESS_DURATION_MS = 4000;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getToasts(): ToastItem[] {
  return toasts;
}
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribeToasts, getToasts);
}

export function dismissToast(id: number): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  notify();
}

// Ignores a toast identical (same kind + message) to one already showing --
// a double-click firing the same action twice before the UI can react
// should read as one event, not two (2026-10-27, user-directed).
function pushToast(kind: ToastKind, message: string): void {
  if (!message) return;
  if (toasts.some((t) => t.kind === kind && t.message === message)) return;
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  notify();
  if (kind === "success") setTimeout(() => dismissToast(id), SUCCESS_DURATION_MS);
}

export function toastSuccess(message: string): void {
  pushToast("success", message);
}
export function toastError(message: string): void {
  pushToast("error", message);
}
