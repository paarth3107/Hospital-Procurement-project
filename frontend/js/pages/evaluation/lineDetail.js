import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, tag, th, emptyRow, fmtDateTime } from "../../kit.js";
import { modalConfirm } from "../../modal.js";
import { openEvaluateDialog } from "./evaluateDialog.js";
import { renderCommercial } from "./commercialStatement.js";
import { state } from "../../state.js";

// One line's evaluation card: who was invited and has submitted (all that
// anyone may see before the deadline), then, after it, the technical
// envelope only. Prices are not part of this card at all.
//
// 2026-10-01, user-directed: this used to be its own standalone page (one
// line at a time, no sense of which lines shared a tender). It's now a
// self-contained block meant to be embedded inside tenderEvaluation.js's
// tender-grouped screen -- lineBlockHtml() renders the card (no back button,
// no tender header, those are shown once at the tender level) from data the
// tender screen already fetched in one call; wireLineBlock() wires its
// actions afterward, scoped to that line's own container so ids/selectors
// never collide with another line's card on the same screen.
const PHASE = {
  bidding_open: ["Bidding open", "att"],
  technical_evaluation: ["Technical evaluation", "esc"],
  technical_closed: ["Technical closed", "pos"],
};

const canSeePrices = (detail) => detail.summary.phase === "technical_closed" && ["procurement_officer", "system_admin"].includes(state.user?.role);

function evaluationCell(row, detail) {
  // Only evaluators see (their own) evaluations; nothing about bid content is shown in this table.
  if (!row.submitted || !detail.can_see_evaluations) return "";
  const mine = row.evaluations.find((e) => e.mine);
  const others = detail.technical_closed_at ? row.evaluations.filter((e) => !e.mine) : [];
  const line = (e) => `<div class="fs-12-5px">${esc(e.evaluator)}: ${tag(e.decision, e.decision === "qualified" ? "pos" : "neg")}${e.weighted_score != null ? ` <b>${e.weighted_score}</b><span class="ep-sub">/100</span>` : ""}${e.comments ? `<div class="ep-sub">${esc(e.comments)}</div>` : ""}</div>`;
  const shown = [...(mine ? [mine] : []), ...others].map(line).join("");
  return `${shown || '<span class="ep-sub">Not evaluated by you</span>'}<div class="ep-sub">${row.evaluation_count} evaluator(s) have evaluated</div>`;
}

function resultCell(row) {
  const r = row.result;
  if (!r) return "";
  return `${tag(r.outcome, r.outcome === "qualified" ? "pos" : "neg")}${r.t_rank ? ` <b>T${r.t_rank}</b>` : ""}${r.consolidated_score != null ? `<div class="ep-sub">score ${r.consolidated_score} / 100</div>` : ""}${r.reason ? `<div class="ep-sub maxw-220px">${esc(r.reason)}</div>` : ""}`;
}

export function lineBlockHtml(detail) {
  const s = detail.summary;
  const [phaseLabel, phaseTone] = PHASE[s.phase];
  const seePrices = canSeePrices(detail);
  const rows = detail.vendors.length
    ? detail.vendors
        .map(
          (r) => `<tr>
            <td class="ep-cell"><div class="fw-600">${esc(r.vendor_name)}</div><div class="ep-sub">rating ${r.rating}</div></td>
            <td class="ep-cell">${r.submitted ? tag("Submitted", "pos") : tag("Not submitted", "att")}${r.submitted_at ? `<div class="ep-sub">${esc(fmtDateTime(r.submitted_at))}</div>` : ""}</td>
            <td class="ep-cell">${evaluationCell(r, detail)}</td>
            <td class="ep-cell">${resultCell(r)}</td>
            <td class="ep-cell text-right">${detail.can_evaluate && r.submitted ? `<button class="ep-b" data-v="p" data-evaluate="${r.vendor_id}">Evaluate</button>` : ""}</td>
          </tr>`
        )
        .join("")
    : emptyRow(5, "No vendors were invited to this line.");
  return `<div class="ep-pane-head"><span>${esc(s.product_name)}</span><span class="ep-k">${s.qty} · ${esc(s.procurement_type)}${
    s.technical_eval_method !== "qualify_disqualify" ? " · scored" : ""
  } · ${tag(phaseLabel, phaseTone)}</span></div>
    <div class="padding-12px-18px-0">
      ${s.phase === "bidding_open" ? '<div class="ep-note">Bids are sealed. Until the due date you can see only who has submitted; technical content and prices stay hidden from everyone.</div>' : ""}
      ${
        detail.can_see_evaluations
          ? detail.scored
            ? `<div class="ep-k mt-6px">Scored out of 100 · minimum qualifying score ${detail.min_technical_score} · qualified bids are T-ranked</div>
              <div class="d-flex flex-wrap gap-8px-22px mt-4px">${detail.criteria.map((c) => `<div class="ep-sub"><b>${c.weight}%</b> ${esc(c.label)}${c.auto ? " (from rating)" : c.optional ? " (optional)" : ""}</div>`).join("")}</div>`
            : `<div class="ep-k mt-6px">Qualify / disqualify — checked against mandatory technical compliance points, no score. Qualified bids stand on equal footing.</div>`
          : ""
      }
    </div>
    <div class="padding-12px-18px-0">
      <div class="ep-sub mb-4px">${s.submitted_count} of ${s.invited_count} submitted</div>
      <table class="ep-table">${th("Vendor", "Submission", "Your evaluation", "Result", "")}<tbody>${rows}</tbody></table>
    </div>
    <div class="padding-14px-18px-18px">
      ${
        s.phase === "technical_closed"
          ? `<div class="ep-note">Technical evaluation is closed and qualification is recorded.${seePrices ? "" : " Prices of the qualified bids are opened to the Procurement Officer for commercial evaluation."}</div>${
              seePrices ? `<div id="ev-commercial-${s.line_item_id}" class="mt-12px"></div>` : ""
            }`
          : detail.can_evaluate
          ? `<div class="d-flex justify-end"><button class="ep-b" data-v="p" id="ev-close-${s.line_item_id}">Close technical evaluation</button></div>`
          : ""
      }
    </div>`;
}

export function wireLineBlock(container, lineId, detail, { onReload, resultEl }) {
  if (canSeePrices(detail)) renderCommercial(container.querySelector(`#ev-commercial-${lineId}`), lineId, resultEl);
  container.querySelectorAll("[data-evaluate]").forEach((b) =>
    b.addEventListener("click", () =>
      openEvaluateDialog(detail.vendors.find((v) => v.vendor_id === Number(b.dataset.evaluate)), (msg) => {
        onReload();
        showResult(resultEl, msg, true);
      })
    )
  );
  container.querySelector(`#ev-close-${lineId}`)?.addEventListener("click", async () => {
    if (
      !(await modalConfirm("Record qualification and rank the qualified bids for this line? After this, scores can't be changed without a governed override.", {
        title: "Close Technical Evaluation",
        confirmLabel: "Close evaluation",
      }))
    )
      return;
    try {
      await api(`/evaluation/lines/${lineId}/close-technical`, { method: "POST" });
      onReload();
      showResult(resultEl, "Technical evaluation closed.", true);
    } catch (err) {
      showResult(resultEl, err.message, false);
    }
  });
}
