import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, kicker, tag, th, emptyRow, fmtDateTime } from "../../kit.js";
import { modalConfirm } from "../../modal.js";
import { openEvaluateDialog } from "./evaluateDialog.js";
import { renderCommercial } from "./commercialStatement.js";
import { state } from "../../state.js";

// One line's evaluation screen: who was invited and has submitted (all that
// anyone may see before the deadline), then, after it, the technical
// envelope only. Prices are not part of this screen at all.
const PHASE = {
  bidding_open: ["Bidding open", "att"],
  technical_evaluation: ["Technical evaluation", "esc"],
  technical_closed: ["Technical closed", "pos"],
};

function evaluationCell(row, detail) {
  // Only evaluators see (their own) evaluations; nothing about bid content is shown in this table.
  if (!row.submitted || !detail.can_see_evaluations) return "";
  const mine = row.evaluations.find((e) => e.mine);
  const others = detail.technical_closed_at ? row.evaluations.filter((e) => !e.mine) : [];
  const line = (e) => `<div style="font-size:12.5px">${esc(e.evaluator)}: ${tag(e.decision, e.decision === "qualified" ? "pos" : "neg")}${e.weighted_score != null ? ` <b>${e.weighted_score}</b><span class="ep-sub">/10</span>` : ""}${e.comments ? `<div class="ep-sub">${esc(e.comments)}</div>` : ""}</div>`;
  const shown = [...(mine ? [mine] : []), ...others].map(line).join("");
  return `${shown || '<span class="ep-sub">Not evaluated by you</span>'}<div class="ep-sub">${row.evaluation_count} evaluator(s) have scored</div>`;
}

function resultCell(row) {
  const r = row.result;
  if (!r) return "";
  return `${tag(r.outcome, r.outcome === "qualified" ? "pos" : "neg")}${r.t_rank ? ` <b>T${r.t_rank}</b>` : ""}${r.consolidated_score != null ? `<div class="ep-sub">score ${r.consolidated_score} / 10</div>` : ""}${r.reason ? `<div class="ep-sub" style="max-width:220px">${esc(r.reason)}</div>` : ""}`;
}

export async function renderLineDetail(container, lineId, { onBack, onReload, resultEl }) {
  let detail;
  try {
    detail = await api(`/evaluation/lines/${lineId}`);
  } catch (err) {
    showResult(resultEl, err.message, false);
    return;
  }
  const s = detail.summary;
  const [phaseLabel, phaseTone] = PHASE[s.phase];
  const canSeePrices = s.phase === "technical_closed" && ["procurement_officer", "system_admin"].includes(state.user?.role);
  const rows = detail.vendors.length
    ? detail.vendors
        .map(
          (r) => `<tr>
            <td class="ep-cell"><div style="font-weight:600">${esc(r.vendor_name)}</div><div class="ep-sub">rating ${r.rating}</div></td>
            <td class="ep-cell">${r.submitted ? tag("Submitted", "pos") : tag("Not submitted", "att")}${r.submitted_at ? `<div class="ep-sub">${esc(fmtDateTime(r.submitted_at))}</div>` : ""}</td>
            <td class="ep-cell">${evaluationCell(r, detail)}</td>
            <td class="ep-cell">${resultCell(r)}</td>
            <td class="ep-cell" style="text-align:right">${detail.can_evaluate && r.submitted ? `<button class="ep-b" data-v="p" data-evaluate="${r.vendor_id}">Evaluate</button>` : ""}</td>
          </tr>`
        )
        .join("")
    : emptyRow(5, "No vendors were invited to this line.");
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    <div><button class="ep-b" id="ev-back">← All lines</button></div>
    <div class="ep-pane ep-pane-pad" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">${kicker(`Tender #${s.tender_id} · ${s.tender_type.toUpperCase()} · ${s.technical_eval_method.replace(/_/g, " ")}`)}
        <h4 style="margin:4px 0 3px;font-size:21px">${esc(s.product_name)}</h4><div class="ep-sub">${esc(s.tender_title)} · ${s.qty} required</div></div>
      <div>${kicker("Bids close")}<div style="font-weight:700;margin-top:3px">${esc(fmtDateTime(s.bid_due_date))}</div></div>
      <div>${kicker("Stage")}<div style="margin-top:5px">${tag(phaseLabel, phaseTone)}</div></div>
    </div>
    ${s.phase === "bidding_open" ? '<div class="ep-note">Bids are sealed. Until the due date you can see only who has submitted; technical content and prices stay hidden from everyone.</div>' : ""}
    ${
      detail.can_see_evaluations
        ? `<div class="ep-pane ep-pane-pad"><div class="ep-k">Scored out of 10 · minimum qualifying score ${detail.min_technical_score}${detail.scored ? " · qualified bids are T-ranked" : " · qualified bids stand on equal footing"}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:8px">${detail.criteria.map((c) => `<div class="ep-sub"><b>${c.weight}%</b> ${esc(c.label)}${c.auto ? " (from rating)" : c.optional ? " (optional)" : ""}</div>`).join("")}</div></div>`
        : ""
    }
    <div class="ep-pane"><div class="ep-pane-head"><span>Invited vendors</span><span class="ep-k">${s.submitted_count} of ${s.invited_count} submitted</span></div>
      <table class="ep-table">${th("Vendor", "Submission", "Your evaluation", "Result", "")}<tbody>${rows}</tbody></table></div>
    ${
      s.phase === "technical_closed"
        ? `<div class="ep-note">Technical evaluation is closed and qualification is recorded.${canSeePrices ? "" : " Prices of the qualified bids are opened to the Procurement Officer for commercial evaluation."}</div>${canSeePrices ? '<div id="ev-commercial"></div>' : ""}`
        : detail.can_evaluate
        ? '<div style="display:flex;justify-content:flex-end"><button class="ep-b" data-v="p" id="ev-close">Close technical evaluation</button></div>'
        : ""
    }
  </div>`;

  container.querySelector("#ev-back").addEventListener("click", onBack);
  if (canSeePrices) renderCommercial(container.querySelector("#ev-commercial"), lineId, resultEl);
  container.querySelectorAll("[data-evaluate]").forEach((b) =>
    b.addEventListener("click", () =>
      openEvaluateDialog(detail.vendors.find((v) => v.vendor_id === Number(b.dataset.evaluate)), (msg) => {
        onReload();
        showResult(resultEl, msg, true);
      })
    )
  );
  container.querySelector("#ev-close")?.addEventListener("click", async () => {
    if (!(await modalConfirm("Record qualification and rank the qualified bids for this line? After this, scores can't be changed without a governed override.", { title: "Close technical evaluation", confirmLabel: "Close evaluation" }))) return;
    try {
      await api(`/evaluation/lines/${lineId}/close-technical`, { method: "POST" });
      onReload();
      showResult(resultEl, "Technical evaluation closed.", true);
    } catch (err) {
      showResult(resultEl, err.message, false);
    }
  });
}
