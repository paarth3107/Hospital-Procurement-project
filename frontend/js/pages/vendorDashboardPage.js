import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { openBid } from "./bid/bidPage.js";
import { switchView } from "../nav.js";
import { esc, tag, stateTag, th, emptyRow, fmtDateTime, inr } from "../kit.js";

// ---- Vendor portal home: tender invitations (the prototype's vTenders
// screen) and the vendor's submitted bids. A status note at the top says
// what to do next (verification pending -> categories -> bidding). ----
const root = () => document.getElementById("vendor-dashboard-root");
const resultEl = () => document.getElementById("vendor-dashboard-result");

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
    const mappings = await api("/vendor-portal/mappings");
    const counts = { approved: 0, pending: 0, rejected: 0, suspended: 0 };
    for (const m of mappings) counts[m.state]++;
    const message = mappings.length
      ? `Your category/item requests: ${["approved", "pending", "rejected", "suspended"].filter((k) => counts[k]).map((k) => `${counts[k]} ${k === "pending" ? "pending review" : k}`).join(", ")}.`
      : "Your documents are approved! Pick which categories (or individual items) you can supply to become eligible for tenders.";
    return `<div class="ep-note"><span>${esc(message)}</span><button class="ep-b" id="goto-profile">Go to Company profile</button></div>`;
  } catch (err) {
    return "";
  }
}

function timeRemaining(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "closed";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export async function loadVendorDashboard() {
  try {
    const vendor = await api("/vendor-auth/me");
    state.vendor = vendor;
    const [note, tenders, bids] = await Promise.all([statusNote(vendor), api("/vendor-portal/tenders"), api("/vendor-portal/bids")]);

    const lineRows = tenders.flatMap((t) => t.line_items.map((li) => ({ t, li })));
    const openLines = lineRows.filter(({ t }) => t.can_bid);
    const soonest = tenders.filter((t) => t.can_bid && t.bid_due_date).map((t) => t.bid_due_date).sort()[0];

    const banner = `<div class="ep-pane" style="padding:15px 18px;display:flex;gap:22px;align-items:center;border-left:3px solid #ec3013">
      <div style="flex:1"><div style="font-size:14px;font-weight:800">${
        lineRows.length ? `You have been invited to ${lineRows.length} line item(s) across ${tenders.length} tender(s)` : "You have no open invitations yet"
      }</div>
        <div class="hint" style="margin-top:3px">You see only the lines you individually qualified for. Lines you are not mapped or rated for are not visible or biddable.</div></div>
      <div style="text-align:right;flex:none">${'<div class="ep-k">Time remaining</div>'}<div style="font-size:22px;font-weight:800;color:#ae1800">${soonest ? timeRemaining(soonest) : "—"}</div></div>
    </div>`;

    const invitations = `<div class="ep-pane">
      <div class="ep-pane-head"><span>Open invitations</span><span class="ep-k">${openLines.length} biddable</span></div>
      <table class="ep-table">${th("Tender", "Line item for you", "Type", "Closes", "Bid status", "")}<tbody>${
        lineRows.length
          ? lineRows
              .map(({ t, li }) => {
                const bs = li.bid_status;
                const status = bs === "submitted" ? tag("Bid submitted", "pos") : bs === "draft" ? tag("Draft saved", "esc") : bs === "withdrawn" ? tag("Withdrawn", "neg") : t.can_bid ? tag("Not submitted", "att") : tag("Deadline passed", "neg");
                const action = t.can_bid
                  ? `<button class="ep-b" ${bs ? "" : 'data-v="p"'} data-line="${li.line_item_id}">${bs === "submitted" ? "View / amend" : bs === "draft" ? "Continue bid" : bs === "withdrawn" ? "Reopen" : "Prepare bid"}</button>`
                  : bs
                  ? `<button class="ep-b" data-line="${li.line_item_id}">View</button>`
                  : "";
                return `<tr>
                  <td class="ep-cell"><div style="font-weight:700">#${t.tender_id}</div><div class="ep-sub">${esc(t.title)}</div></td>
                  <td class="ep-cell" style="font-size:12.5px">${esc(li.product_name)} · ${li.qty}</td>
                  <td class="ep-cell" style="font-size:12px">${esc(t.tender_type)}</td>
                  <td class="ep-cell" style="font-size:12.5px">${fmtDateTime(t.bid_due_date)}</td>
                  <td class="ep-cell">${status}</td>
                  <td class="ep-cell" style="text-align:right">${action}</td></tr>`;
              })
              .join("")
          : emptyRow(6, "No open tenders you're currently invited to.")
      }</tbody></table>
    </div>`;

    const bidsPane = `<div class="ep-pane">
      <div class="ep-pane-head"><span>Your bids</span><span class="ep-k">sealed until the deadline</span></div>
      <table class="ep-table">${th("Tender", "Line item", "Qty", "Your unit price", "Status", "Submitted")}<tbody>${
        bids.length
          ? bids
              .map(
                (b) => `<tr><td class="ep-cell">${esc(b.tender_title)}</td><td class="ep-cell">${esc(b.product_name)}</td><td class="ep-cell">${b.qty}</td>
                  <td class="ep-cell" style="font-weight:700">${b.unit_price == null ? "—" : inr(b.unit_price)}</td><td class="ep-cell">${stateTag(b.status)}</td><td class="ep-cell" style="font-size:12.5px">${b.submitted_at ? fmtDateTime(b.submitted_at) : "—"}</td></tr>`
              )
              .join("")
          : emptyRow(6, "No bids yet.")
      }</tbody></table>
    </div>`;

    root().innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">${note}${banner}${invitations}${bidsPane}</div>`;
    root().querySelector("#goto-profile")?.addEventListener("click", () => switchView("vendor-profile"));
    root().querySelectorAll("button[data-line]").forEach((b) => b.addEventListener("click", () => openBid(Number(b.dataset.line))));
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load dashboard: " + err.message, false);
  }
}
