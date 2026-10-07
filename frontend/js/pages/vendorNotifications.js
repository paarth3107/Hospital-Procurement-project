import { api } from "../api.js";
import { esc, tag, fmtDateTime } from "../kit.js";

// The vendor's portal notifications (award/regret/technical result, document
// verify/reject, registration status changes) and the closing-soon
// reminder. Both used to have their own inline spot on the vendor dashboard;
// as of 2026-10-07 they live only in the top bell (shell.js), which is this
// module's only remaining caller.
const TONE = {
  awarded: ["Awarded", "pos"],
  regret: ["Not selected", "esc"],
  technical_disqualified: ["Technical result", "neg"],
  document_verified: ["Document", "pos"],
  document_rejected: ["Document", "neg"],
  vendor_active: ["Registration", "pos"],
  vendor_rejected: ["Registration", "neg"],
  vendor_info_requested: ["Registration", "esc"],
  vendor_suspended: ["Account", "neg"],
  vendor_blacklisted: ["Account", "neg"],
};

// A tender is "closing soon" if it's still biddable and due within 24 hours.
// Synthetic, not persisted -- there's no scheduler to pre-generate a
// Notification row for this, so it's recomputed fresh from
// GET /vendor-portal/tenders wherever it's needed (the dashboard's own
// banner, the top bell).
export function closingSoonTenders(tenders) {
  const soon = Date.now() + 24 * 3600 * 1000;
  return tenders.filter((t) => t.can_bid && t.bid_due_date && new Date(t.bid_due_date).getTime() < soon);
}

// The top bell's dropdown content for a vendor (shell.js): real
// notifications plus a synthetic closing-soon row per tender, newest/most
// urgent first. Markup only -- shell.js wires the dismiss buttons
// (wireBellRows below) and the closing-soon rows itself (it needs
// openTenderBid, which would be a circular import from here).
export function bellRowsHtml(notes, tenders) {
  const unread = notes.filter((n) => !n.read).slice(0, 6);
  const soon = closingSoonTenders(tenders);
  if (!unread.length && !soon.length) {
    return `<div class="ep-dropdown-head">Notifications</div><div class="ep-dropdown-empty">You're all caught up.</div>`;
  }
  const soonRows = soon
    .map(
      (t) => `<button type="button" class="ep-notif-item" data-open-bid="${t.tender_id}">
        <div class="d-flex items-center gap-8px flex-wrap">${tag("Closing soon", "att")}<span class="fw-700 fs-13px">${esc(t.title)}</span></div>
        <div class="ep-sub mt-4px fs-12-5px">Closes ${esc(fmtDateTime(t.bid_due_date))} — submit soon or it'll pass without a bid.</div>
      </button>`
    )
    .join("");
  const noteRows = unread
    .map((n) => {
      const [label, tone] = TONE[n.kind] || [n.kind, ""];
      return `<div class="ep-notif-item">
        <div class="d-flex justify-between items-start gap-8px">
          <div class="d-flex items-center gap-8px flex-wrap">${tag(label, tone)}<span class="fw-700 fs-13px">${esc(n.title)}</span></div>
          <button type="button" class="ep-notif-dismiss" data-read="${n.id}" title="Dismiss" aria-label="Dismiss">✕</button>
        </div>
        <div class="ep-sub mt-4px fs-12-5px">${esc(n.body)}</div>
      </div>`;
    })
    .join("");
  return `<div class="ep-dropdown-head">Notifications</div>${soonRows}${noteRows}`;
}

// Wires the dismiss ("✕") buttons on bellRowsHtml()'s real-notification rows.
export function wireBellRows(container, onChange) {
  container.querySelectorAll("[data-read]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api(`/vendor-portal/notifications/${b.dataset.read}/read`, { method: "POST" });
      onChange();
    })
  );
}
