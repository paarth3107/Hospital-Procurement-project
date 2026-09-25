import { api } from "../../api.js";
import { state } from "../../state.js";
import { showResult } from "../../ui.js";
import { esc, kicker, stateTag, tag, fmtDateTime } from "../../kit.js";
import { modalConfirm } from "../../modal.js";
import { switchView } from "../../nav.js";
import { commercialHtml, technicalHtml, readBid, wireTotals } from "./bidFields.js";
import { attachmentsHtml, wireAttachments } from "./bidAttachments.js";

// ---- Bid form for one tender line (vendor, spec 8): commercial part,
// technical part and attachments, saved as a draft, submitted, amended or
// withdrawn until the deadline. The server enforces every rule; a submit that
// is missing anything comes back with the exact list. ----
const root = () => document.getElementById("bid-root");
const resultEl = () => document.getElementById("bid-result");

let lineId = null;
let form = null; // last BidFormOut from the server
let unsaved = null; // form values typed but not saved, kept across an attachment upload

export function openBid(id) {
  lineId = id;
  unsaved = null;
  switchView("bid");
}

const pane = (title, right, body) => `<div class="ep-pane"><div class="ep-pane-head"><span>${title}</span>${right || ""}</div><div style="padding:16px 18px">${body}</div></div>`;

function render() {
  const { context: ctx, requirements: req, locked, lock_reason: lockReason } = form;
  const bid = form.bid ? { ...form.bid, ...(unsaved || {}), details: { ...form.bid.details, ...(unsaved?.details || {}) } } : unsaved;
  const status = form.bid?.status;
  const submitted = status === "submitted";
  root().innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    <div><button class="ep-b" id="bid-back">← Back to invitations</button></div>
    <div class="ep-pane ep-pane-pad" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">${kicker(`Tender #${ctx.tender_id} · ${ctx.tender_type.toUpperCase()}`)}
        <h4 style="margin:4px 0 3px;font-size:21px">${esc(ctx.product_name)}</h4>
        <div class="ep-sub">${esc(ctx.tender_title)} · ${ctx.qty}${ctx.uom ? " " + esc(ctx.uom) : ""} required · ${esc(ctx.procurement_type)}</div></div>
      <div>${kicker("Closes")}<div style="font-weight:700;margin-top:3px">${esc(fmtDateTime(ctx.bid_due_date))}</div></div>
      <div>${kicker("Your bid")}<div style="margin-top:5px">${status ? stateTag(status) : tag("Not started", "att")}</div></div>
    </div>
    ${locked ? `<div class="ep-note warn">${esc(lockReason)} ${form.bid ? "You can still view what you submitted." : ""}</div>` : ""}
    ${submitted && !locked ? '<div class="ep-note">This bid is submitted. You can amend or withdraw it until the deadline.</div>' : ""}
    ${status === "withdrawn" ? '<div class="ep-note">You withdrew this bid. Saving it again reopens it as a draft.</div>' : ""}
    <form id="bid-form" data-type="${esc(ctx.procurement_type)}" style="display:flex;flex-direction:column;gap:18px;background:transparent;border:0;padding:0">
      ${pane("Commercial", '<span class="ep-k">sealed until the deadline</span>', commercialHtml(ctx, bid, req, locked))}
      ${pane("Technical", "", technicalHtml(ctx, bid, req, locked))}
      ${pane("Attachments", '<span class="ep-k">PDF, DOCX, XLSX, JPG, PNG · 10 MB each</span>', `<div id="bid-attachments">${attachmentsHtml(form.bid, req, locked)}</div>`)}
    </form>
    <div id="bid-inline-result" class="result"></div>
    ${
      locked
        ? ""
        : `<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
            ${submitted ? '<button class="ep-b" id="bid-withdraw">Withdraw bid</button>' : '<button class="ep-b" id="bid-draft">Save draft</button>'}
            <button class="ep-b" data-v="p" id="bid-submit">${submitted ? "Save amendment" : "Submit bid"}</button>
          </div>`
    }
  </div>`;

  const formEl = root().querySelector("#bid-form");
  formEl.addEventListener("submit", (e) => e.preventDefault());
  wireTotals(formEl, ctx.qty);
  root().querySelector("#bid-back").addEventListener("click", () => switchView("vendor-dashboard"));
  const inline = (msg, ok = false) => showResult(root().querySelector("#bid-inline-result"), msg, ok);

  // The distributor toggle makes the manufacturer authorization letter mandatory (Asset lines).
  const dist = formEl.elements["details.bidding_as_distributor"];
  if (dist) {
    const sync = () => {
      const slot = root().querySelector('[data-slot="manufacturer_authorization"] [data-mandatory-tag]');
      if (slot && !form.bid?.attachments.some((a) => a.kind === "manufacturer_authorization")) slot.innerHTML = dist.checked ? tag("required", "att") : '<span class="ep-sub">optional</span>';
    };
    dist.addEventListener("change", sync);
    sync();
  }

  const save = async (submit) => {
    const body = { ...readBid(formEl), submit };
    form = await api(`/vendor-portal/bids/line/${lineId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    unsaved = null;
    return form.bid.id;
  };

  wireAttachments(root().querySelector("#bid-attachments"), form.bid?.id ?? null, {
    ensureBid: () => save(false),
    onChanged: async () => {
      unsaved = readBid(formEl);
      await reload();
    },
    onError: (m) => inline(m, false),
  });

  root().querySelector("#bid-draft")?.addEventListener("click", async () => {
    try {
      await save(false);
      render();
      inline("Draft saved.", true);
    } catch (err) {
      inline(err.message, false);
    }
  });
  root().querySelector("#bid-submit")?.addEventListener("click", async () => {
    if (!submitted && !(await modalConfirm("Submit this bid? You can amend or withdraw it until the deadline.", { title: "Submit bid", confirmLabel: "Submit" }))) return;
    try {
      await save(true);
      state.flash = submitted ? "Your amended bid was saved." : "Your bid was submitted.";
      switchView("vendor-dashboard");
    } catch (err) {
      inline(err.message, false);
    }
  });
  root().querySelector("#bid-withdraw")?.addEventListener("click", async () => {
    if (!(await modalConfirm("Withdraw this bid? You can reopen it as a draft and submit again before the deadline.", { title: "Withdraw bid", confirmLabel: "Withdraw", danger: true }))) return;
    try {
      form = await api(`/vendor-portal/bids/${form.bid.id}/withdraw`, { method: "POST" });
      render();
      inline("Bid withdrawn.", true);
    } catch (err) {
      inline(err.message, false);
    }
  });
}

async function reload() {
  form = await api(`/vendor-portal/bids/line/${lineId}`);
  render();
}

export async function loadBid() {
  if (lineId == null) {
    switchView("vendor-dashboard");
    return;
  }
  try {
    await reload();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load the bid form: " + err.message, false);
  }
}
