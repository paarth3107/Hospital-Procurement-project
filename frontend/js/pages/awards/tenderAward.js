import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, kicker, tag, stateTag, fmtDateTime, inr } from "../../kit.js";
import { modalConfirm } from "../../modal.js";
import { STATE, DECISION_LABEL, allocationsHtml, statementHtml } from "./awardHelpers.js";
import { recommendationFormHtml, readRecommendation, wireRecommendation } from "./recommendationForm.js";
import { decisionFormHtml, readDecision, wireDecision } from "./decisionForm.js";

// One tender's award screen: every line with its comparative statement, the
// Officer's recommendation, the Approving Authority's decision and the round
// history. Officer: recommend each line, then submit the tender for L1
// approval. Approving Authority: decide each submitted line.
function roundHtml(r) {
  const dec = r.decision_kind ? `${DECISION_LABEL[r.decision_kind] || r.decision_kind}${r.decided_by ? ` by ${esc(r.decided_by)}` : ""}${r.decided_at ? ` · ${esc(fmtDateTime(r.decided_at))}` : ""}` : "";
  return `<div style="padding:6px 0;border-top:1px solid rgba(32,30,29,.12);font-size:12.5px">
    <b>Round ${r.round_number}</b> · ${tag(r.status, r.status === "approved" ? "pos" : r.status === "rejected" ? "neg" : "att")} ${r.kind === "exclude" ? "· left out of the award" : ""}
    <div>${r.kind === "exclude" ? "" : `Officer: ${allocationsHtml(r.proposed)}`}${r.is_override ? ` ${tag("override", "att")}` : ""}</div>
    ${r.officer_reason ? `<div class="ep-sub">Reason: ${esc(r.officer_reason)}</div>` : ""}
    ${dec ? `<div>${dec}</div>` : ""}${r.final.length ? `<div>Final: ${allocationsHtml(r.final)}</div>` : ""}
    ${r.decision_comments ? `<div class="ep-sub">Comments: ${esc(r.decision_comments)}</div>` : ""}</div>`;
}

function lineHtml(line) {
  const [label, tone] = STATE[line.state];
  const c = line.current;
  const summary =
    c && line.state !== "none"
      ? `<div style="margin-top:10px;font-size:13px">${kicker(`Round ${c.round_number}`)}
          <div style="margin-top:3px">${c.kind === "exclude" ? "Recommended: leave this line out of the award" : `Recommended: ${allocationsHtml(c.proposed)}`}${c.is_override ? ` ${tag("not the system's top-ranked", "att")}` : ""}</div>
          ${c.officer_reason ? `<div class="ep-sub" style="white-space:pre-wrap">Reason: ${esc(c.officer_reason)}</div>` : ""}
          ${line.state === "approved" || line.state === "excluded" ? `<div style="margin-top:4px;font-weight:600">${DECISION_LABEL[c.decision_kind] || ""} — ${c.kind === "exclude" ? "no award" : allocationsHtml(c.final)}</div>` : ""}
          ${c.decision_comments ? `<div class="ep-sub">Approver's comments: ${esc(c.decision_comments)}</div>` : ""}</div>`
      : "";
  const older = line.history.filter((r) => !c || r.round_number !== c.round_number);
  return `<div class="ep-pane" data-line="${line.line_item_id}"><div class="ep-pane-head"><span>${esc(line.product_name)} <span class="ep-sub" style="font-weight:400">${esc(line.product_code)} · ${line.qty}${line.uom ? " " + esc(line.uom) : ""}</span></span><span>${tag(label, tone)}</span></div>
    <div style="padding:14px 16px">
      <div class="ep-sub">${esc(line.evaluation_method.replace(/_/g, " "))}${line.split_award_allowed ? " · split award allowed" : ""}</div>
      ${line.technical_closed ? statementHtml(line) : '<div class="hint" style="margin-top:8px">Technical evaluation is not closed for this line yet.</div>'}
      ${summary}
      ${older.length ? `<details style="margin-top:8px"><summary class="ep-sub" style="cursor:pointer">Earlier rounds (${older.length})</summary>${older.map(roundHtml).join("")}</details>` : ""}
      ${
        line.can_recommend
          ? line.state === "draft"
            ? `<div style="margin-top:10px"><button class="ep-b" data-edit-rec="${line.line_item_id}">Edit recommendation</button></div><div data-rec-wrap="${line.line_item_id}" hidden>${recommendationFormHtml(line)}</div>`
            : recommendationFormHtml(line)
          : ""
      }
      ${line.can_decide ? decisionFormHtml(line) : ""}
    </div></div>`;
}

export async function renderTenderAward(container, tenderId, { onBack, resultEl }) {
  let t;
  const load = async () => (t = await api(`/awards/tenders/${tenderId}`));
  try {
    await load();
  } catch (err) {
    showResult(resultEl, "Could not load this tender: " + err.message, false);
    return;
  }
  const paint = (message) => {
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
      <div><button class="ep-b" id="aw-back">← All tenders</button></div>
      <div class="ep-pane ep-pane-pad" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">${kicker(`Tender #${t.tender_id}`)}<h4 style="margin:4px 0 3px;font-size:22px">${esc(t.title)}</h4><div class="ep-sub">${esc(t.facility_name)}${t.department ? " · " + esc(t.department) : ""}</div></div>
        <div>${kicker("Status")}<div style="margin-top:5px">${t.status === "awarded" ? tag("Awarded", "pos") : tag("Award in progress", "att")}</div>${t.awarded_at ? `<div class="ep-sub">${esc(fmtDateTime(t.awarded_at))}</div>` : ""}</div>
        ${t.required_tier ? `<div>${kicker("Waiting for approval")}<div style="font-size:20px;font-weight:800;margin-top:3px">${inr(t.pending_value)}</div><div class="ep-sub">needs tier ${t.required_tier}</div></div>` : ""}
      </div>
      ${
        t.status === "awarded"
          ? `<div class="ep-pane"><div class="ep-pane-head"><span>PO data files</span></div><table class="ep-table"><tbody>${t.po_files.map((f) => `<tr><td class="ep-cell" style="font-weight:600">${esc(f.batch_id)}</td><td class="ep-cell">${esc(f.vendor_name)}</td><td class="ep-cell">${stateTag(f.status)}</td></tr>`).join("")}</tbody></table></div>`
          : t.submit_blockers.length
          ? `<div class="ep-note">${t.submit_blockers.map(esc).join("<br>")}</div>`
          : ""
      }
      ${t.lines.map(lineHtml).join("")}
      ${t.can_submit ? '<div style="display:flex;justify-content:flex-end"><button class="ep-b" data-v="p" id="aw-submit">Submit for L1 approval</button></div>' : ""}
    </div>`;
    container.querySelector("#aw-back").addEventListener("click", onBack);
    if (message) showResult(resultEl, message, true);

    const run = async (fn, okMsg, out) => {
      try {
        t = await fn();
        paint(okMsg);
      } catch (err) {
        (out ? showResult(out, err.message, false) : showResult(resultEl, err.message, false));
      }
    };
    container.querySelectorAll("[data-edit-rec]").forEach((b) =>
      b.addEventListener("click", () => {
        const wrap = container.querySelector(`[data-rec-wrap="${b.dataset.editRec}"]`);
        wrap.hidden = !wrap.hidden;
        b.textContent = wrap.hidden ? "Edit recommendation" : "Close editor";
      })
    );
    container.querySelectorAll("[data-rec]").forEach((panel) => {
      const line = t.lines.find((l) => l.line_item_id === Number(panel.dataset.rec));
      wireRecommendation(panel, line);
      panel.querySelector("[data-save-rec]").addEventListener("click", () => {
        const body = readRecommendation(panel, line);
        if (body) run(() => api(`/awards/lines/${line.line_item_id}/recommendation`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), `Recommendation saved for ${line.product_name}.`, panel.querySelector(".result"));
      });
    });
    container.querySelectorAll("[data-dec]").forEach((panel) => {
      const line = t.lines.find((l) => l.line_item_id === Number(panel.dataset.dec));
      wireDecision(panel);
      panel.querySelector("[data-save-dec]").addEventListener("click", () => {
        const body = readDecision(panel, line);
        if (body) run(() => api(`/awards/lines/${line.line_item_id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), body.decision === "reject" ? `Returned ${line.product_name} to the Officer.` : `Decision recorded for ${line.product_name}.`, panel.querySelector(".result"));
      });
    });
    container.querySelector("#aw-submit")?.addEventListener("click", async () => {
      if (!(await modalConfirm("Submit every line's recommendation to the Approving Authority for L1 approval?", { title: "Submit for L1 approval", confirmLabel: "Submit" }))) return;
      run(() => api(`/awards/tenders/${tenderId}/submit`, { method: "POST" }), "Submitted for L1 approval.");
    });
  };
  paint();
}
