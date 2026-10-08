// Small markup helpers for the prototype's recurring patterns (kicker, tag,
// pane, button, formatting) so page modules stay readable. Every helper
// returns an HTML string; user data always goes through esc().
import { icon } from "./icons.js";

export const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const kicker = (text) => `<div class="ep-k">${esc(text)}</div>`;

// A reserved image slot (2026-10-07) -- there's no upload feature yet for
// either catalog entries or vendor logos, but the layout is built as if
// there were, so dropping in real thumbnails later is a data change, not a
// layout change. size: "sm" (table row, 40px) | "md" (card/avatar, 64px) |
// "lg" (the Add Product form's image card, fills its container).
export const imgPlaceholder = (iconName = "image", size = "sm") => `<div class="ep-thumb ep-thumb-${size}">${icon(iconName, size === "lg" ? 28 : size === "md" ? 20 : 16)}</div>`;

// Canonical staff-role display labels (2026-10-07) -- the one place "procurement_officer"
// becomes "Procurement Officer" everywhere a role is shown (sidebar identity, the account
// menu, Staff Accounts, the audit log), instead of each screen formatting the raw enum
// value its own way. Falls back to the raw value for anything not a staff role (a vendor
// row's actor_type, say), same as every call site already did before this existed.
export const ROLE_LABELS = {
  procurement_officer: "Procurement Officer",
  procurement_admin: "Procurement Admin",
  category_manager: "Category Manager",
  approving_authority: "Approving Authority",
  system_admin: "System Admin",
};
export const roleLabel = (role) => ROLE_LABELS[role] || role;

// The sidebar/account-menu's role line for a logged-in staff user: the role
// label plus the approval tier, when the login carries one (Approving
// Authority only) -- so the two Approving Authority demo logins (tier 1 vs
// tier 3) stay distinguishable without stuffing the tier into their name.
export const staffRoleLabel = (user) => roleLabel(user.role) + (user.approval_tier ? ` · Tier ${user.approval_tier}` : "");

// tone: "" neutral | pos | att | neg | esc | asset | service
export const tag = (text, tone = "") => `<span class="ep-tag"${tone ? ` data-t="${tone}"` : ""}>${esc(text)}</span>`;

const STATE_TONE = {
  active: "pos", approved: "pos", verified: "pos", published: "pos", accepted: "pos", awarded: "pos",
  pending: "", pending_verification: "", draft: "", submitted: "",
  pending_approval: "att", info_requested: "esc", escalated: "esc",
  rejected: "neg", suspended: "neg", blacklisted: "neg", withdrawn: "neg", expired: "neg", disqualified: "neg", no_award: "neg",
};
export const stateTag = (state) => tag(String(state || "—").replace(/_/g, " "), STATE_TONE[state] ?? "");

const TYPE_TONE = { item: "item", asset: "asset", service: "service" };
export const typeTag = (type) => tag(type, TYPE_TONE[type] ?? "");

export const btn = (label, { primary = false, attrs = "" } = {}) =>
  `<button class="ep-b"${primary ? ' data-v="p"' : ""} ${attrs}>${label}</button>`;

// A ruled panel with an optional header bar (title left, kicker/actions right).
export const pane = (title, right, body) =>
  `<div class="ep-pane">${
    title ? `<div class="ep-pane-head"><span>${title}</span>${right ? `<span class="ep-k">${right}</span>` : ""}</div>` : ""
  }${body}</div>`;

export const th = (...labels) => `<thead><tr>${labels.map((l) => `<th class="ep-th">${l}</th>`).join("")}</tr></thead>`;
export const emptyRow = (cols, text) => `<tr><td class="ep-cell text-ink-55" colspan="${cols}">${text}</td></tr>`;

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

// ---- Pagination (2026-09-30): every list in the app is expected to grow
// into the hundreds once this is live, so any list/log page uses this pair
// instead of rendering everything at once. Usage: keep a module-level `page`
// variable, call pageSlice(items, page) to get what to render plus how many
// pages exist, render paginationBar(...) below the table, and wire its two
// button ids to decrement/increment `page` and re-render. ----
export const PAGE_SIZE = 20;

export function pageSlice(items, page, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  return { pageItems: items.slice(clamped * pageSize, clamped * pageSize + pageSize), totalPages, page: clamped };
}

// Which page numbers to show around the current one (Vuexy's own pagination
// truncates the same way instead of listing every page): first, last, and a
// window around `page`, everything else collapsed into an ellipsis.
function pageWindow(page, totalPages) {
  const keep = new Set([0, totalPages - 1, page - 1, page, page + 1]);
  return [...keep].filter((p) => p >= 0 && p < totalPages).sort((a, b) => a - b);
}

export function paginationBar(page, totalPages, prevId, nextId) {
  if (totalPages <= 1) return "";
  let numbered = "";
  let last = -1;
  for (const p of pageWindow(page, totalPages)) {
    if (last !== -1 && p - last > 1) numbered += `<span class="ep-page-ellipsis">…</span>`;
    numbered += `<button type="button" class="ep-page-btn${p === page ? " active" : ""}" data-page="${p}" aria-current="${p === page}">${p + 1}</button>`;
    last = p;
  }
  return `<nav class="ep-pagination" aria-label="Pagination">
    <button type="button" class="ep-page-arrow" id="${prevId}" ${page <= 0 ? "disabled" : ""} aria-label="Previous page">‹</button>
    ${numbered}
    <button type="button" class="ep-page-arrow" id="${nextId}" ${page >= totalPages - 1 ? "disabled" : ""} aria-label="Next page">›</button>
  </nav>`;
}

// Wires a paginationBar()'s prev/next arrows and its numbered page pills;
// `setPage` should update the module's page variable and re-render (the same
// function the list's own filters use).
export function wirePagination(root, prevId, nextId, page, setPage) {
  root.querySelector(`#${prevId}`)?.addEventListener("click", () => setPage(page - 1));
  root.querySelector(`#${nextId}`)?.addEventListener("click", () => setPage(page + 1));
  root.querySelectorAll(".ep-page-btn[data-page]").forEach((b) => b.addEventListener("click", () => setPage(Number(b.dataset.page))));
}
