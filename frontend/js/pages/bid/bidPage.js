import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, kicker, stateTag, tag, fmtDateTime } from "../../kit.js";
import { modalConfirm } from "../../modal.js";
import { switchView } from "../../nav.js";
import { commercialHtml, technicalHtml, readBid, wireTotals, wireCompliance } from "./bidFields.js";
import { attachmentsHtml, wireAttachments } from "./bidAttachments.js";

// ---- Bid workspace for one tender (vendor, spec 8): opening "Prepare Bid" on
// a tender shows every line item the vendor is eligible for in it, one block
// each, instead of the vendor stepping into one line at a time. A bid is
// still one row per line server-side (spec 8.2) -- each block saves,
// submits, amends and withdraws independently; this only changes how many
// the vendor can act on in one sitting. UI for this is intentionally plain
// for now (to be redesigned later); the per-line form fields themselves are
// unchanged, just repeated once per eligible line. ----
const root = () => document.getElementById("bid-root");
const resultEl = () => document.getElementById("bid-result");

let tenderId = null;
let lines = []; // [{ lineId, form, unsaved }]

export function openTenderBid(id) {
  tenderId = id;
  lines = [];
  switchView("bid");
}

const pane = (title, right, body) => `<div class="ep-pane"><div class="ep-pane-head"><span>${title}</span>${right || ""}</div><div style="padding:16px 18px">${body}</div></div>`;

function lineBlock(entry) {
  const { lineId, form, unsaved } = entry;
  const { context: ctx, requirements: req, locked, lock_reason: lockReason } = form;
  const bid = form.bid ? { ...form.bid, ...(unsaved || {}), details: { ...form.bid.details, ...(unsaved?.details || {}) } } : unsaved;
  const status = form.bid?.status;
  const submitted = status === "submitted";
  return `<div class="ep-pane" data-line-block="${lineId}">
    <div class="ep-pane-head"><span>${esc(ctx.product_name)}</span><span class="ep-k">${ctx.qty}${ctx.uom ? " " + esc(ctx.uom) : ""} · ${esc(ctx.procurement_type)} · ${status ? stateTag(status) : tag("Not started", "att")}</span></div>
    <div style="padding:12px 18px 0">
      ${locked ? `<div class="ep-note warn">${esc(lockReason)} ${form.bid ? "You can still view what you submitted." : ""}</div>` : ""}
      ${submitted && !locked ? '<div class="ep-note">This bid is submitted. You can amend or withdraw it until the deadline.</div>' : ""}
      ${status === "withdrawn" ? '<div class="ep-note">You withdrew this bid. Saving it again reopens it as a draft.</div>' : ""}
    </div>
    <form data-bid-form="${lineId}" data-type="${esc(ctx.procurement_type)}" style="display:flex;flex-direction:column;gap:18px;padding:12px 18px 18px">
      ${pane("Commercial", '<span class="ep-k">sealed until the deadline</span>', commercialHtml(ctx, bid, req, locked))}
      ${pane("Technical", "", technicalHtml(ctx, bid, req, locked))}
      ${pane("Attachments", '<span class="ep-k">PDF, DOCX, XLSX, JPG, PNG · 10 MB each</span>', `<div id="bid-attachments-${lineId}">${attachmentsHtml(form.bid, req, locked)}</div>`)}
    </form>
    <div id="bid-inline-result-${lineId}" class="result" style="margin:0 18px 12px"></div>
    ${
      locked
        ? ""
        : `<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;padding:0 18px 18px">
            ${submitted ? `<button class="ep-b" data-withdraw="${lineId}">Withdraw bid</button>` : `<button class="ep-b" data-draft="${lineId}">Save draft</button>`}
            <button class="ep-b" data-v="p" data-submit-line="${lineId}">${submitted ? "Save amendment" : "Submit bid"}</button>
          </div>`
    }
  </div>`;
}

function render() {
  const ctx = lines[0]?.form?.context;
  root().innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    <div><button class="ep-b" id="bid-back">← Back to invitations</button></div>
    ${
      ctx
        ? `<div class="ep-pane ep-pane-pad" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">${kicker(`Tender #${ctx.tender_id} · ${ctx.tender_type.toUpperCase()}`)}
        <h4 style="margin:4px 0 3px;font-size:21px">${esc(ctx.tender_title)}</h4>
        <div class="ep-sub">${lines.length} line item(s) you're eligible to bid on</div></div>
      <div>${kicker("Closes")}<div style="font-weight:700;margin-top:3px">${esc(fmtDateTime(ctx.bid_due_date))}</div></div>
    </div>`
        : ""
    }
    ${lines.length ? lines.map(lineBlock).join("") : '<div class="ep-pane ep-pane-pad hint">No lines you can bid on in this tender.</div>'}
  </div>`;

  root()
    .querySelector("#bid-back")
    .addEventListener("click", () => switchView("vendor-dashboard"));

  for (const entry of lines) {
    const { lineId, form } = entry;
    const formEl = root().querySelector(`[data-bid-form="${lineId}"]`);
    if (!formEl) continue;
    formEl.addEventListener("submit", (e) => e.preventDefault());
    wireTotals(formEl, form.context.qty);
    wireCompliance(formEl);
    const inline = (msg, ok = false) => showResult(root().querySelector(`#bid-inline-result-${lineId}`), msg, ok);

    // The distributor toggle makes the manufacturer authorization letter mandatory (Asset lines).
    const dist = formEl.elements["details.bidding_as_distributor"];
    if (dist) {
      const sync = () => {
        const slot = root().querySelector(`[data-line-block="${lineId}"] [data-slot="manufacturer_authorization"] [data-mandatory-tag]`);
        if (slot && !form.bid?.attachments.some((a) => a.kind === "manufacturer_authorization")) slot.innerHTML = dist.checked ? tag("required", "att") : '<span class="ep-sub">optional</span>';
      };
      dist.addEventListener("change", sync);
      sync();
    }

    const save = async (submit) => {
      const body = { ...readBid(formEl), submit };
      entry.form = await api(`/vendor-portal/bids/line/${lineId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      entry.unsaved = null;
      return entry.form.bid.id;
    };

    wireAttachments(root().querySelector(`#bid-attachments-${lineId}`), form.bid?.id ?? null, {
      ensureBid: () => save(false),
      onChanged: async () => {
        entry.unsaved = readBid(formEl);
        entry.form = await api(`/vendor-portal/bids/line/${lineId}`);
        render();
      },
      onError: (m) => inline(m, false),
    });

    root()
      .querySelector(`[data-draft="${lineId}"]`)
      ?.addEventListener("click", async () => {
        try {
          await save(false);
          render();
          showResult(root().querySelector(`#bid-inline-result-${lineId}`), "Draft saved.", true);
        } catch (err) {
          inline(err.message, false);
        }
      });
    root()
      .querySelector(`[data-submit-line="${lineId}"]`)
      ?.addEventListener("click", async () => {
        const wasSubmitted = form.bid?.status === "submitted";
        if (!wasSubmitted && !(await modalConfirm("Submit this bid? You can amend or withdraw it until the deadline.", { title: "Submit Bid", confirmLabel: "Submit" }))) return;
        try {
          await save(true);
          render();
          showResult(root().querySelector(`#bid-inline-result-${lineId}`), wasSubmitted ? "Amendment saved." : "Bid submitted.", true);
        } catch (err) {
          inline(err.message, false);
        }
      });
    root()
      .querySelector(`[data-withdraw="${lineId}"]`)
      ?.addEventListener("click", async () => {
        if (!(await modalConfirm("Withdraw this bid? You can reopen it as a draft and submit again before the deadline.", { title: "Withdraw Bid", confirmLabel: "Withdraw", danger: true }))) return;
        try {
          entry.form = await api(`/vendor-portal/bids/${form.bid.id}/withdraw`, { method: "POST" });
          render();
          showResult(root().querySelector(`#bid-inline-result-${lineId}`), "Bid withdrawn.", true);
        } catch (err) {
          inline(err.message, false);
        }
      });
  }
}

export async function loadBid() {
  if (tenderId == null) {
    switchView("vendor-dashboard");
    return;
  }
  try {
    const tenders = await api("/vendor-portal/tenders");
    const t = tenders.find((x) => x.tender_id === tenderId);
    const lineIds = t ? t.line_items.map((li) => li.line_item_id) : [];
    lines = await Promise.all(lineIds.map(async (lineId) => ({ lineId, form: await api(`/vendor-portal/bids/line/${lineId}`), unsaved: null })));
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load the bid form: " + err.message, false);
  }
}
