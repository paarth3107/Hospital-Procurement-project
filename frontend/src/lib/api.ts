// Typed mirror of frontend/js/api.js, used only by ported React pages (the
// vanilla api.js keeps serving unconverted pages untouched -- see
// .claude-notes/REACT-MIGRATION-PLAN.md). Reads the same sessionStorage key
// the vanilla app's login flow already writes, rather than importing
// state.js directly, so this bundle has zero dependency on the old frontend's
// internals -- just a shared contract (the key name) on the same origin.
export const API_BASE = "/api/v1";

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = sessionStorage.getItem("token");
  return { ...(extra || {}), ...(token ? { Authorization: "Bearer " + token } : {}) };
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + path, { ...options, headers: authHeaders(options.headers) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message = detail ?? res.statusText;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return body as T;
}

// For requests that need the raw Response (file downloads/exports), same as
// api.js callers that use `fetch(...)` directly instead of the `api()` helper.
export function apiHeaders(extra?: HeadersInit): HeadersInit {
  return authHeaders(extra);
}
