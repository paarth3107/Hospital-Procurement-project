import { api } from "../api.js";
import { showResult } from "../ui.js";
import { esc, th, emptyRow, tag, fmtDateTime, inr } from "../kit.js";
import { refreshChrome } from "../nav.js";
import { renderReview } from "./approvals/reviewPanel.js";

// ---- E-Tender approval (Module 4B): the gate that publishes a tender to
// its eligible vendors. The inbox lists tenders waiting on a decision at their
// resolved tier; Review opens everything the approver needs (header terms,
// lines, the vendors each would go to, history) and the decision lives there,
// so nothing is approved or rejected without being looked at. ----
const root = () => document.getElementById("approvals-root");
const resultEl = () => document.getElementById("approval-result");

async function showInbox(message) {
  try {
    const tenders = await api("/tenders?status_filter=pending_approval");
    const rows = await Promise.all(
      tenders.map(async (t) => {
        const [rounds, review] = await Promise.all([api(`/tenders/${t.id}/approval-rounds`), api(`/tenders/${t.id}/approval-review`)]);
        return { t, round: rounds.find((r) => r.round_number === t.round_number), review };
      })
    );
    root().innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
      <div class="hint" style="max-width:900px;line-height:1.5">The gate that actually publishes a tender and notifies vendors. Open a tender to review all of its details before deciding. Each submission is a numbered round; a rejection returns it to Draft with mandatory comments, and repeated rejections escalate to the next approving tier.</div>
      <div class="ep-pane">
        <div class="ep-pane-head"><span>Approval inbox</span><span class="ep-k">${rows.length} pending</span></div>
        <table class="ep-table">${th("Tender", "Round", "Value", "Required tier", "Bids close", "")}<tbody>${
          rows.length
            ? rows
                .map(
                  ({ t, round, review }) => `<tr>
                    <td class="ep-cell"><div style="font-weight:600">${esc(t.title)}</div><div class="ep-sub">#${t.id}${t.department ? " · " + esc(t.department) : ""} · ${review.lines.length} line(s)</div>${review.warnings.length ? `<div class="ep-sub" style="color:#ae1800">${review.warnings.length} warning(s)</div>` : ""}</td>
                    <td class="ep-cell">${t.round_number}</td>
                    <td class="ep-cell" style="font-weight:600">${inr(review.total_estimated_value)}</td>
                    <td class="ep-cell">${tag(round ? "Tier " + round.required_tier : "—", "att")}</td>
                    <td class="ep-cell" style="font-size:12.5px">${fmtDateTime(t.bid_due_date)}</td>
                    <td class="ep-cell" style="text-align:right"><button class="ep-b" data-v="p" data-review="${t.id}">Review</button></td></tr>`
                )
                .join("")
            : emptyRow(6, "Nothing is waiting for approval.")
        }</tbody></table>
      </div>
    </div>`;
    root().querySelectorAll("[data-review]").forEach((b) => b.addEventListener("click", () => showReview(Number(b.dataset.review))));
    if (message) showResult(resultEl(), message, true);
    else resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load approval queue: " + err.message, false);
  }
}

function showReview(id) {
  resultEl().textContent = "";
  return renderReview(root(), id, {
    onBack: () => showInbox(),
    onDecided: (msg) => {
      showInbox(msg);
      refreshChrome();
    },
    resultEl: resultEl(),
  });
}

export const loadApprovals = () => showInbox();
