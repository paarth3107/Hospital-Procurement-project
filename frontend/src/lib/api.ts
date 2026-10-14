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
        reject(new Error(typeof message === "string" ? message : JSON.stringify(message)));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(formData);
  });
}
