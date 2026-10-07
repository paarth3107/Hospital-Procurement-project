import { api } from "../../api.js";
import { esc, fmtDateTime } from "../../kit.js";

// The banner on the registration screen for an Open Tender link (2026-10-06):
// says which tender the vendor is registering for, and where it stands.
const LEAD = {
  unpublished: "is not published yet. You'll see it listed once it's published.",
  open: "is open for bids. You'll see it listed as soon as your registration is approved, and you can bid while bidding is open.",
  closed: "has closed for bidding, so registering through this link can't be completed.",
};

export async function showOpenLinkBanner() {
  const el = document.getElementById("open-link-banner");
  const token = sessionStorage.getItem("openLinkToken");
  el.hidden = !token;
  if (!token) return;
  try {
    const t = await api(`/open-links/${token}`);
    const place = [t.facility_name, t.department].filter(Boolean).join(" · ");
    const due = t.bid_due_date ? ` · bids close ${fmtDateTime(t.bid_due_date)}` : "";
    el.innerHTML = `<div class="ep-note"><span><b>${esc(t.title)}</b>${place ? ` · ${esc(place)}` : ""}${due}<br>This tender ${LEAD[t.state]}</span></div>`;
  } catch (err) {
    sessionStorage.removeItem("openLinkToken");
    el.innerHTML = `<div class="ep-note warn"><span>${esc(err.message)}</span></div>`;
  }
}
