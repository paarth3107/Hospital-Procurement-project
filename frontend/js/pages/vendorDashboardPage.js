import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { openBid } from "./bid/bidPage.js";
import { notificationsHtml, wireNotifications } from "./vendorNotifications.js";
import { scorecardHtml } from "./ratings/scorecard.js";
import { switchView, refreshChrome } from "../nav.js";
import { esc, kicker, tag, stateTag, th, emptyRow, fmtDateTime, inr, pageSlice, paginationBar, wirePagination } from "../kit.js";

// ---- Vendor portal home: tenders the vendor is invited to (grouped one row
// per tender, not per line item -- a real tender can carry hundreds of line
// items, so drilling into one is a separate step) and the vendor's submitted
// bids. A status note at the top says what to do next (verification pending
// -> categories -> bidding). ----
const root = () => document.getElementById("vendor-dashboard-root");
const resultEl = () => document.getElementById("vendor-dashboard-result");

// Tenders in one of these statuses are done -- nothing left to act on. Kept
// out of "Open Invitations" by default (they pile up forever otherwise);
// a checkbox reveals them again without a refetch.
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);
let showClosed = false;
let selectedTenderId = null;
let invitesPage = 0;
let bidsPage = 0;

const NOTES = {
  pending_verification: "Verification pending: your registration and documents are with our team for review. You'll be able to request categories once they're approved.",
  info_requested: "More information requested: check the note on your profile and re-upload any rejected documents under Company profile.",
  rejected: "Your registration was not approved. See the note on your profile.",
  suspended: "Your account is suspended: you can't bid or be invited to new tenders until it's reinstated. See the note on your profile.",
};

async function statusNote(vendor) {
  if (vendor.status !== "active") {
    const why = ["suspended", "info_requested", "rejected"].includes(vendor.status) && vendor.rejection_reason ? ` Reason: ${vendor.rejection_reason}` : "";
    return `<div class="ep-note"><span>${esc((NOTES[vendor.status] || "Your registration is not active yet.") + why)}</span>${
      ["info_requested", "suspended"].includes(vendor.status) ? '<button class="ep-b" id="goto-profile">Open profile</button>' : ""
    }</div>`;
  }
  try {
    const [mappings, reqs] = await Promise.all([api("/vendor-portal/mappings"), api("/vendor-portal/documents/requirements")]);
    const owed = reqs.filter((r) => r.summary === "documents_needed");
    const counts = { approved: 0, pending: 0, rejected: 0, suspended: 0 };
    for (const m of mappings) counts[m.state]++;
    // Only say something while there is something to do: nothing requested yet, or a request was
    // rejected / suspended. Approved or pending requests need no message.
    const message = !mappings.length
      ? "Your documents are approved! Pick which categories (or individual items) you can supply to become eligible for tenders."
      : counts.rejected || counts.suspended
      ? `${[counts.rejected ? `${counts.rejected} request(s) rejected` : "", counts.suspended ? `${counts.suspended} suspended` : ""].filter(Boolean).join(", ")} — see Category Declaration.`
      : null;
    const owedNote = owed.length
      ? `<div class="ep-note warn"><span>New documents are required for ${owed.length} of your items (${esc(owed.slice(0, 3).map((r) => r.product_name).join(", "))}${owed.length > 3 ? "…" : ""}). Upload them in Category Declaration; you can bid on those items once they are verified.</span><button class="ep-b" data-v="p" id="goto-profile-docs">Upload documents</button></div>`
      : "";
    return `${owedNote}${message ? `<div class="ep-note"><span>${esc(message)}</span><button class="ep-b" id="goto-profile">Go to Category Declaration</button></div>` : ""}`;
  } catch (err) {
    return "";
  }
}

function kpiStrip(openCount, bids, ratings) {
  const submitted = bids.filter((b) => b.status === "submitted").length;
  const awarded = bids.filter((b) => b.outcome && b.outcome.startsWith("Awarded")).length;
  const ratingValue = ratings.length === 1 ? ratings[0].overall_score.toFixed(0) : ratings.length ? String(ratings.length) : "—";
  const ratingSub = ratings.length === 1 ? ratings[0].procurement_type : ratings.length ? "type(s) rated" : "not yet rated";
  const cells = [
    ["Open Invitations", openCount, "you can bid now"],
    ["Bids Submitted", submitted, "prices sealed until deadline"],
    ["Awarded", awarded, "line(s) won"],
    ["My Rating", ratingValue, ratingSub],
  ];
  return `<div class="ep-kpis">${cells
    .map(([label, value, sub]) => `<div class="ep-kpi">${kicker(label)}<div class="ep-kpi-value">${esc(value)}</div><div class="ep-sub">${esc(sub)}</div></div>`)
    .join("")}</div>`;
}

// Rating visibility (2026-09-30): a vendor previously had no way to see their
// own score, even though it's exactly what the eligibility resolver filters
// invitations on. Reuses the staff scorecard component as-is, read-only.
function ratingPanel(ratings) {
  if (!ratings.length) {
    return `<div class="ep-pane ep-pane-pad"><div class="ep-k">Your Rating</div>
      <div class="hint" style="margin-top:8px">You haven't been rated yet — this starts once you're approved for a category and begin supplying under it.</div></div>`;
  }
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Your Rating</span><span class="ep-k">one score per procurement type you're rated in</span></div>
    <div style="padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${ratings
      .map((r) => scorecardHtml(state.vendor, r, r.procurement_type, false))
      .join("")}</div>
  </div>`;
}

// An expired document silently suspends bidding the next time the expiry
// sweep runs -- surfaced here instead of only discoverable by trying to bid.
function expiryNote(docs) {
  const issues = docs.filter((d) => d.expiry_state === "expiring" || d.expiry_state === "expired");
  if (!issues.length) return "";
  const expired = issues.filter((d) => d.expiry_state === "expired");
  const label = (d) => esc(d.custom_label || d.doc_type.replace(/_/g, " "));
  const names = issues.slice(0, 3).map(label).join(", ") + (issues.length > 3 ? "…" : "");
  const text = expired.length
    ? `${expired.length} document(s) have expired (${names}). This can suspend your account until they're renewed.`
    : `${issues.length} document(s) are expiring soon (${names}). Renew them before they lapse.`;
  return `<div class="ep-note warn"><span>${text}</span><button class="ep-b" data-v="p" id="goto-profile-expiry">Open Company profile</button></div>`;
}

function timeRemaining(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "closed";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// One row per tender you're invited to, not per line item -- a real tender
// can carry hundreds of lines, so the line-level detail is a drill-down
// (renderTenderLines), not this list.
function groupByTender(lineRows) {
  const map = new Map();
  for (const { t, li } of lineRows) {
    if (!map.has(t.tender_id)) map.set(t.tender_id, { t, lines: [] });
    map.get(t.tender_id).lines.push(li);
  }
  return [...map.values()];
}

function tenderRow(group) {
  const { t, lines } = group;
  const closed = CLOSED_TENDER_STATUSES.has(t.status);
  const submitted = lines.filter((li) => li.bid_status === "submitted").length;
  const statusTag = closed
    ? tag(t.status === "awarded" ? "Tender awarded" : "Closed, no award", "neg")
    : !t.can_bid
    ? tag("Deadline passed", "neg")
    : submitted === lines.length
    ? tag("All submitted", "pos")
    : submitted > 0
    ? tag(`${submitted} of ${lines.length} submitted`, "att")
    : tag("Not started", "att");
  const closesIn = t.can_bid && t.bid_due_date ? `<div class="ep-sub">${timeRemaining(t.bid_due_date)} left</div>` : "";
  return `<tr>
    <td class="ep-cell"><div style="font-weight:700">#${t.tender_id}</div><div class="ep-sub">${esc(t.title)}</div></td>
    <td class="ep-cell" style="font-size:12px">${esc(t.tender_type)}</td>
    <td class="ep-cell" style="font-size:12.5px">${lines.length}</td>
    <td class="ep-cell" style="font-size:12.5px">${fmtDateTime(t.bid_due_date)}${closesIn}</td>
    <td class="ep-cell">${statusTag}</td>
    <td class="ep-cell" style="text-align:right"><button class="ep-b" data-v="p" data-view-tender="${t.tender_id}">View lines</button></td>
  </tr>`;
}

function renderTenderList(lineRows, closedCount, openLinesCount) {
  const allGroups = groupByTender(lineRows);
  const { pageItems, totalPages, page } = pageSlice(allGroups, invitesPage);
  invitesPage = page;
  return {
    page,
    totalPages,
    html: `<div class="ep-pane">
      <div class="ep-pane-head"><span>Open Invitations</span>
        <div style="display:flex;align-items:center;gap:14px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;text-transform:none;letter-spacing:0;color:rgba(32,30,29,.7)">
            <input type="checkbox" id="show-closed-invites" ${showClosed ? "checked" : ""}> Show closed/awarded (${closedCount})
          </label>
          <span class="ep-k">${openLinesCount} biddable</span>
        </div>
      </div>
      <table class="ep-table">${th("Tender", "Type", "Line Items", "Closes", "Status", "")}<tbody>${
        pageItems.length ? pageItems.map(tenderRow).join("") : emptyRow(6, showClosed ? "No tenders you're invited to." : "No open tenders you're currently invited to.")
      }</tbody></table>
      ${paginationBar(page, totalPages, "invites-prev", "invites-next")}
    </div>`,
  };
}

function renderTenderLines(selectedGroup) {
  const t = selectedGroup[0]?.t;
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>${t ? esc(t.title) : "Tender"}</span><button class="ep-b" id="back-to-tenders">← All invitations</button></div>
    ${t ? `<div style="padding:10px 16px 0" class="ep-sub">#${t.tender_id} · ${esc(t.tender_type)} · Closes ${fmtDateTime(t.bid_due_date)}</div>` : ""}
    <table class="ep-table">${th("Item", "Bid Status", "")}<tbody>${
      selectedGroup.length
        ? selectedGroup
            .map(({ t, li }) => {
              const bs = li.bid_status;
              const closed = CLOSED_TENDER_STATUSES.has(t.status);
              const status = bs === "submitted" ? tag("Bid submitted", "pos") : bs === "draft" ? tag("Draft saved", "esc") : bs === "withdrawn" ? tag("Withdrawn", "neg") : t.can_bid ? tag("Not submitted", "att") : closed ? tag(t.status === "awarded" ? "Tender awarded" : "Closed, no award", "neg") : tag("Deadline passed", "neg");
              const action = t.can_bid
                ? `<button class="ep-b" ${bs ? "" : 'data-v="p"'} data-line="${li.line_item_id}">${bs === "submitted" ? "View / amend" : bs === "draft" ? "Continue bid" : bs === "withdrawn" ? "Reopen" : "Prepare bid"}</button>`
                : bs
                ? `<button class="ep-b" data-line="${li.line_item_id}">View</button>`
                : "";
              return `<tr><td class="ep-cell"><div style="font-weight:600">${esc(li.product_name)}</div><div class="ep-sub">${li.qty}</div></td><td class="ep-cell">${status}</td><td class="ep-cell" style="text-align:right">${action}</td></tr>`;
            })
            .join("")
        : emptyRow(3, "No lines.")
    }</tbody></table>
  </div>`;
}

function bidsPane(bids) {
  const { pageItems, totalPages, page } = pageSlice(bids, bidsPage);
  bidsPage = page;
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Your Bids</span><span class="ep-k">sealed until the deadline</span></div>
    <table class="ep-table">${th("Tender", "Line Item", "Qty", "Your Unit Price", "Status", "Outcome")}<tbody>${
      pageItems.length
        ? pageItems
            .map(
              (b) => `<tr><td class="ep-cell">${esc(b.tender_title)}</td><td class="ep-cell">${esc(b.product_name)}</td><td class="ep-cell">${b.qty}</td>
                <td class="ep-cell" style="font-weight:700">${b.unit_price == null ? "—" : inr(b.unit_price)}</td><td class="ep-cell">${stateTag(b.status)}</td><td class="ep-cell" style="font-size:12.5px;font-weight:600">${b.outcome ? esc(b.outcome) : `<span class="ep-sub">${b.submitted_at ? "Awaiting result" : "—"}</span>`}</td></tr>`
            )
            .join("")
        : emptyRow(6, "No bids yet.")
    }</tbody></table>
    ${paginationBar(page, totalPages, "bids-prev", "bids-next")}
  </div>`;
}

function render(note, tenders, bids, notes, ratings, docs) {
  const allLineRows = tenders.flatMap((t) => t.line_items.map((li) => ({ t, li })));
  const closedCount = allLineRows.filter(({ t }) => CLOSED_TENDER_STATUSES.has(t.status)).length;
  // Soonest-closing first -- lines with no due date (shouldn't happen for a
  // published line, but be defensive) sort last rather than first.
  const byDeadline = (a, b) => new Date(a.t.bid_due_date || 8640000000000000) - new Date(b.t.bid_due_date || 8640000000000000);
  const lineRows = (showClosed ? allLineRows : allLineRows.filter(({ t }) => !CLOSED_TENDER_STATUSES.has(t.status))).slice().sort(byDeadline);
  const openLines = lineRows.filter(({ t }) => t.can_bid);
  const closingSoon = openLines.filter(({ t }) => t.bid_due_date && new Date(t.bid_due_date) - Date.now() < 24 * 3600 * 1000);
  const closingSoonNote = closingSoon.length
    ? `<div class="ep-note warn"><span>${closingSoon.length} line item(s) close within 24 hours — submit soon or they'll pass without a bid.</span></div>`
    : "";

  const selectedGroup = selectedTenderId != null ? lineRows.filter(({ t }) => t.tender_id === selectedTenderId) : null;
  let invitationsHtml, invitesPageClamped, invitesTotalPages;
  if (selectedGroup) {
    invitationsHtml = renderTenderLines(selectedGroup);
  } else {
    const built = renderTenderList(lineRows, closedCount, openLines.length);
    invitationsHtml = built.html;
    invitesPageClamped = built.page;
    invitesTotalPages = built.totalPages;
  }

  root().innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">${note}${expiryNote(docs)}${notificationsHtml(notes)}${kpiStrip(openLines.length, bids, ratings)}${closingSoonNote}${invitationsHtml}${bidsPane(bids)}${ratingPanel(ratings)}</div>`;
  wireNotifications(root(), () => { loadVendorDashboard(); refreshChrome(); });
  root().querySelector("#goto-profile")?.addEventListener("click", () => switchView("vendor-categories"));
  root().querySelector("#goto-profile-docs")?.addEventListener("click", () => switchView("vendor-categories"));
  root().querySelector("#goto-profile-expiry")?.addEventListener("click", () => switchView("vendor-profile"));
  root().querySelectorAll("button[data-line]").forEach((b) => b.addEventListener("click", () => openBid(Number(b.dataset.line))));
  const rerender = () => render(note, tenders, bids, notes, ratings, docs);
  root().querySelector("#show-closed-invites")?.addEventListener("change", (e) => {
    showClosed = e.target.checked;
    invitesPage = 0;
    rerender();
  });
  root().querySelector("#back-to-tenders")?.addEventListener("click", () => {
    selectedTenderId = null;
    rerender();
  });
  root().querySelectorAll("[data-view-tender]").forEach((b) =>
    b.addEventListener("click", () => {
      selectedTenderId = Number(b.dataset.viewTender);
      rerender();
    })
  );
  if (!selectedGroup) wirePagination(root(), "invites-prev", "invites-next", invitesPageClamped, (p) => { invitesPage = p; rerender(); });
  wirePagination(root(), "bids-prev", "bids-next", bidsPage, (p) => { bidsPage = p; rerender(); });
}

export async function loadVendorDashboard() {
  try {
    const vendor = await api("/vendor-auth/me");
    state.vendor = vendor;
    const [note, tenders, bids, notes, ratings, docs] = await Promise.all([
      statusNote(vendor),
      api("/vendor-portal/tenders"),
      api("/vendor-portal/bids"),
      api("/vendor-portal/notifications"),
      api("/vendor-portal/ratings"),
      api("/vendor-portal/documents"),
    ]);
    render(note, tenders, bids, notes, ratings, docs);
    resultEl().textContent = "";
    if (state.flash) {
      showResult(resultEl(), state.flash, true);
      state.flash = null;
    }
  } catch (err) {
    showResult(resultEl(), "Could not load dashboard: " + err.message, false);
  }
}
