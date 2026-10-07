import { esc, pageSlice, paginationBar, wirePagination } from "../../kit.js";
import { icon } from "../../icons.js";

// Vuexy's "Assignment Progress" card: a row per tender with a percentage
// ring, what's happening on it, and a chevron through to it. Shared by every
// dashboard that has a "Tenders" pane (Officer, Approving Authority) so the
// pagination (2026-10-07 -- these used to render every row at once, unlike
// every other list in the app) and the ring/tone rule only live in one
// place. `subtitle(t)` builds the one-line status text per role; `onOpen(id)`
// decides where the chevron goes.
const PAGE_SIZE = 6;

// Tone for the progress ring: green on track, amber a bit behind, red only
// for a line that's genuinely stalled (deadline passed, still under
// halfway), grey for a tender just starting out.
function progressTone(t, value) {
  if (t.status === "published" && t.bid_due_date && new Date(t.bid_due_date) <= new Date() && value <= 55) return "danger";
  if (value >= 65) return "success";
  if (value >= 20) return "warning";
  return "muted";
}

export function renderTenderProgressCard(root, paneId, tenders, subtitle, onOpen) {
  let page = 0;
  function render() {
    const { pageItems, totalPages, page: clamped } = pageSlice(tenders, page, PAGE_SIZE);
    page = clamped;
    const rows = pageItems.length
      ? pageItems
          .map((t) => {
            const value = t.progress_pct;
            const tone = progressTone(t, value);
            return `<div class="assign-row d-flex items-center gap-14px">
              <div class="assign-ring ring-tone-${tone}" style="--ring-value: ${value}"><div class="assign-ring-hole">${value}%</div></div>
              <div class="flex-1 minw-0">
                <div class="fw-600">${esc(t.title)}</div>
                <div class="ep-sub mt-2px">${esc(subtitle(t))}</div>
              </div>
              <button type="button" class="assign-chevron" data-open="${t.id}" aria-label="Open ${esc(t.title)}">${icon("chevron-right", 16)}</button>
            </div>`;
          })
          .join("")
      : '<div class="ep-sub">Nothing in progress right now.</div>';
    const pane = root.querySelector(`#${paneId}`);
    pane.innerHTML = `<div class="ep-pane-head"><span>Tenders</span><span class="ep-k">${tenders.length} in progress</span></div>
      <div class="assign-list">${rows}</div>
      ${paginationBar(page, totalPages, `${paneId}-prev`, `${paneId}-next`)}`;
    pane.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => onOpen(Number(b.dataset.open))));
    wirePagination(pane, `${paneId}-prev`, `${paneId}-next`, page, (p) => {
      page = p;
      render();
    });
  }
  render();
}
