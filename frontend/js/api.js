import { state } from "./state.js";

// Points at the deployed backend (2026-10-08, user-directed) -- the frontend
// is run locally (no build step, just opened/served off disk) while the API
// itself lives on the deployed server, not a local uvicorn. Was a relative
// "/api/v1", which only works when frontend and backend share one origin;
// CORS on the backend (main.py) is wide open (allow_origins=["*"]) so this
// cross-origin call works as-is. Change back to a relative path to go back
// to a same-origin local backend.
export const API_BASE = "http://103.209.146.49:8005/api/v1";

export function apiHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  return headers;
}

export async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: apiHeaders(options.headers),
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    // no body
  }
  if (!res.ok) {
    const message = (body && body.detail) || res.statusText;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return body;
}
