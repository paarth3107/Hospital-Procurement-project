// Small markup helpers for the prototype's recurring patterns (kicker, tag,
// pane, button, formatting) so page modules stay readable. Every helper
// returns an HTML string; user data always goes through esc().
export const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const kicker = (text) => `<div class="ep-k">${esc(text)}</div>`;

// tone: "" neutral | pos | att | neg | esc | asset | service
export const tag = (text, tone = "") => `<span class="ep-tag"${tone ? ` data-t="${tone}"` : ""}>${esc(text)}</span>`;

const STATE_TONE = {
  active: "pos", approved: "pos", verified: "pos", published: "pos", accepted: "pos",
  pending: "", pending_verification: "", draft: "", submitted: "",
  pending_approval: "att", info_requested: "esc", escalated: "esc",
  rejected: "neg", suspended: "neg", blacklisted: "neg", withdrawn: "neg", expired: "neg", disqualified: "neg",
};
export const stateTag = (state) => tag(String(state || "—").replace(/_/g, " "), STATE_TONE[state] ?? "");

const TYPE_TONE = { item: "", asset: "asset", service: "service" };
export const typeTag = (type) => tag(type, TYPE_TONE[type] ?? "");

export const btn = (label, { primary = false, attrs = "" } = {}) =>
  `<button class="ep-b"${primary ? ' data-v="p"' : ""} ${attrs}>${label}</button>`;

// A ruled panel with an optional header bar (title left, kicker/actions right).
export const pane = (title, right, body, extraStyle = "") =>
  `<div class="ep-pane" style="${extraStyle}">${
    title ? `<div class="ep-pane-head"><span>${title}</span>${right ? `<span class="ep-k">${right}</span>` : ""}</div>` : ""
  }${body}</div>`;

export const th = (...labels) => `<thead><tr>${labels.map((l) => `<th class="ep-th">${l}</th>`).join("")}</tr></thead>`;
export const emptyRow = (cols, text) => `<tr><td class="ep-cell" colspan="${cols}" style="color:rgba(32,30,29,.55)">${text}</td></tr>`;

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// Indian digit grouping, rupee sign (prototype convention).
export function inr(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// "Expired" / "Expiring <date>" tag for a document with a valid-till date ("" if none/ok).
export const expiryTag = (doc) =>
  doc.expiry_state === "expired" ? tag("Expired", "neg") : doc.expiry_state === "expiring" ? tag(`Expiring ${fmtDate(doc.valid_till)}`, "att") : "";
