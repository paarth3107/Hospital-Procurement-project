import { state } from "./state.js";

export const API_BASE = "/api/v1";

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
