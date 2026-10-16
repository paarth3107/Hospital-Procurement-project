// Typed mirror of frontend/js/api.js, used only by ported React pages (the
// vanilla api.js keeps serving unconverted pages untouched -- see
// .claude-notes/REACT-MIGRATION-PLAN.md). Reads the same sessionStorage key
// the vanilla app's login flow already writes, rather than importing
// state.js directly, so this bundle has zero dependency on the old frontend's
// internals -- just a shared contract (the key name) on the same origin.
import { beginFetch, endFetch } from "./loadingStore";

export const API_BASE = "/api/v1";

// Real bug, found 2026-10-15, user-reported: a login attempt during a DB
// outage just sat there forever with zero feedback -- `fetch()` has no
// timeout of its own, so a backend that never responds (the DB itself was
// unreachable, so the request handler never got anywhere) left the
// returned promise pending indefinitely. It never rejected, so no
// catch block -- even a correctly-written one -- ever ran. Every api()
// call now gives up after REQUEST_TIMEOUT_MS and actually throws, so
// there's always something to show.
const REQUEST_TIMEOUT_MS = 20_000;

// `status: null` means the request never got an HTTP response at all
// (network failure or our own timeout) -- callers that need to tell "the
// session is actually invalid" (401/403) apart from "the server didn't
// answer" (null) can check this instead of string-matching .message.
// AuthBoot.tsx is the reason this exists: it used to log the user out on
// ANY failure fetching /auth/me, including a timeout -- actively wrong,
// not just unhelpful, since the session wasn't invalid at all.
export class ApiError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = sessionStorage.getItem("token");
  return { ...(extra || {}), ...(token ? { Authorization: "Bearer " + token } : {}) };
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  beginFetch();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(API_BASE + path, { ...options, headers: authHeaders(options.headers), signal: controller.signal });
    } catch (err) {
      // Anything thrown here is network-level -- fetch() never even got an
      // HTTP response to hand back (offline, DNS failure, connection
      // refused/dropped, or our own timeout above firing). Browser-native
      // messages for this ("Failed to fetch", "Load failed"...) are
      // inconsistent and not something a non-technical user should have to
      // parse, so every case here collapses into one plain explanation.
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError("The server is taking too long to respond. Please try again in a moment.", null);
      }
      throw new ApiError("Could not reach the server. Check your connection and try again.", null);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // no body
    }
    if (!res.ok) {
      // A 5xx means the server itself is the problem (an unhandled
      // exception, the DB rejecting a query, etc.) -- its `detail` is
      // whatever FastAPI's default handler produced, not a message written
      // for an end user, so this is deliberately NOT shown verbatim. A 4xx
      // keeps today's behavior: those `detail` messages ARE written for
      // the user ("Invalid credentials", "Vendor not found", ...).
      if (res.status >= 500) {
        throw new ApiError("Something went wrong on our end. Please try again in a moment.", res.status);
      }
      const detail = (body as { detail?: unknown } | null)?.detail;
      const message = detail ?? res.statusText;
      throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), res.status);
    }
    return body as T;
  } finally {
    clearTimeout(timeoutId);
    endFetch();
  }
}

// For requests that need the raw Response (file downloads/exports), same as
// api.js callers that use `fetch(...)` directly instead of the `api()` helper.
export function apiHeaders(extra?: HeadersInit): HeadersInit {
  return authHeaders(extra);
}

// A file upload with real byte-level progress (2026-10-13, user-requested --
// "make something like the circular progress indicator for file uploads").
// `fetch` has no upload-progress API at all (only download progress, via a
// manual ReadableStream reader on the response body) -- `XMLHttpRequest`'s
// `upload.onprogress` is the only standard way to get this, so this is a
// separate helper from `api()`, not an option added to it. Same error-
// shape contract as `api()` (throws Error with the backend's `detail`
// message on a non-2xx response) so callers don't need two different
// catch-block shapes depending on which one they used.
export function uploadWithProgress<T>(path: string, formData: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_BASE + path);
    const headers = authHeaders() as Record<string, string>;
    for (const key of Object.keys(headers)) xhr.setRequestHeader(key, headers[key]);
    // No Content-Type set by hand -- same as fetch(formData), the browser
    // fills in the multipart boundary itself only when left alone.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // no body / not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
      } else {
        const detail = (body as { detail?: unknown } | null)?.detail;
        const message = detail ?? xhr.statusText ?? `Upload failed (${xhr.status})`;
        reject(new ApiError(typeof message === "string" ? message : JSON.stringify(message), xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Could not reach the server. Check your connection and try again.", null));
    xhr.onabort = () => reject(new ApiError("Upload cancelled", null));
    // Longer than api()'s REQUEST_TIMEOUT_MS on purpose -- this is a total-
    // duration timeout (XHR has no "stalled" detection, only "took too
    // long overall"), and a real upload legitimately takes longer than a
    // plain JSON request on a slow connection. Files are already capped at
    // 2MB (document_store.py), so even a slow connection finishes well
    // under this; it's a safety net for a genuinely hung server, not a
    // realistic upload duration.
    xhr.timeout = 60_000;
    xhr.ontimeout = () => reject(new ApiError("The server is taking too long to respond. Please try again in a moment.", null));
    xhr.send(formData);
  });
}
