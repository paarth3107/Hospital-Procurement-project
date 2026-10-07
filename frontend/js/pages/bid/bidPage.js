import { api, API_BASE, apiHeaders } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, kicker, fmtDateTime } from "../../kit.js";
import { switchView } from "../../nav.js";
import { setFromServer, getTenderCtx } from "./bidLineItems.js";

// ---- Bid workspace for one tender (spec §8): thin shell around the bid
// grid (bidLineItems.js, 2026-10-01) -- this module only owns loading the
// tender's bid data and rendering the header above the grid. ----
const headerEl = () => document.getElementById("bid-tender-header");
const resultEl = () => document.getElementById("bid-result");

let tenderId = null;

export function openTenderBid(id) {
  tenderId = id;
  switchView("bid");
}

function renderHeader() {
  const ctx = getTenderCtx();
  if (!ctx) {
    headerEl().innerHTML = "";
    return;
  }
  headerEl().innerHTML = `<div class="ep-pane ep-pane-pad mt-14px">
    <div class="d-flex gap-24px items-center flex-wrap">
      <div class="flex-1 minw-260px">${kicker(`Tender #${ctx.tender_id} · ${ctx.tender_type.toUpperCase()} · ${ctx.facility_name}`)}
        <h4 class="margin-4px-0-3px fs-21px">${esc(ctx.tender_title)}</h4>
      </div>
      <div>${kicker("Closes")}<div class="fw-700 mt-3px">${esc(fmtDateTime(ctx.bid_due_date))}</div></div>
    </div>
    ${ctx.tender_description ? `<div class="hint mt-10px">${esc(ctx.tender_description)}</div>` : ""}
    ${
      ctx.terms_document_filename
        ? `<div class="mt-12px"><div class="ep-k">Terms &amp; conditions</div>
            <button type="button" class="ep-b mt-4px" id="bid-terms-download">${esc(ctx.terms_document_filename)} — download</button></div>`
        : ""
    }
  </div>`;
  document.getElementById("bid-terms-download")?.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API_BASE}/vendor-portal/bids/tender/${ctx.tender_id}/terms-document/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (err) {
      showResult(resultEl(), err.message, false);
    }
  });
}

export async function loadBid() {
  if (tenderId == null) {
    switchView("vendor-dashboard");
    return;
  }
  try {
    const data = await api(`/vendor-portal/bids/tender/${tenderId}`);
    setFromServer(data);
    renderHeader();
    resultEl().textContent = "";
  } catch (err) {
    headerEl().innerHTML = "";
    showResult(resultEl(), "Could not load the bid form: " + err.message, false);
  }
}

document.getElementById("bid-back").addEventListener("click", () => switchView("vendor-dashboard"));
