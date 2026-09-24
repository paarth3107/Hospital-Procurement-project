import { api } from "../api.js";
import { showResult } from "../ui.js";
import { modalPrompt } from "../modal.js";
import { esc, th, emptyRow, tag, fmtDateTime } from "../kit.js";
import { refreshChrome } from "../nav.js";

// ---- E-Tender approval (Module 4B): the gate that publishes a tender to
// its eligible vendors. Each row is a tender waiting on a decision at its
// resolved approval tier. ----
const root = () => document.getElementById("approvals-root");
const resultEl = () => document.getElementById("approval-result");

export async function loadApprovals() {
  try {
    const tenders = await api("/tenders?status_filter=pending_approval");
    const rows = await Promise.all(
      tenders.map(async (t) => {
        const rounds = await api(`/tenders/${t.id}/approval-rounds`);
        return { t, round: rounds.find((r) => r.round_number === t.round_number) };
      })
    );
    root().innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
      <div class="hint" style="max-width:900px;line-height:1.5">The gate that actually publishes a tender and notifies vendors. Each submission is a numbered round; a rejection returns it to Draft with mandatory comments, and repeated rejections escalate to the next approving tier.</div>
      <div class="ep-pane">
        <div class="ep-pane-head"><span>Approval inbox</span><span class="ep-k">${rows.length} pending</span></div>
        <table class="ep-table">${th("Tender", "Round", "Required tier", "Bids close", "Decision")}<tbody>${
          rows.length
            ? rows
                .map(
                  ({ t, round }) => `<tr>
                    <td class="ep-cell"><div style="font-weight:600">${esc(t.title)}</div><div class="ep-sub">#${t.id}${t.department ? " · " + esc(t.department) : ""}</div></td>
                    <td class="ep-cell">${t.round_number}</td>
                    <td class="ep-cell">${tag(round ? "Tier " + round.required_tier : "—", "att")}</td>
                    <td class="ep-cell" style="font-size:12.5px">${fmtDateTime(t.bid_due_date)}</td>
                    <td class="ep-cell" style="text-align:right;white-space:nowrap">
                      <button class="ep-b" data-id="${t.id}" data-action="reject">Reject</button>
                      <button class="ep-b" data-v="p" data-id="${t.id}" data-action="approve">Approve &amp; publish</button>
                    </td></tr>`
                )
                .join("")
            : emptyRow(5, "Nothing is waiting for approval.")
        }</tbody></table>
      </div>
    </div>`;
    root().querySelectorAll("button[data-action]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.id, b.dataset.action)));
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load approval queue: " + err.message, false);
  }
}

async function decide(id, action) {
  try {
    if (action === "reject") {
      const comments = await modalPrompt("Comments for rejection (required):");
      if (!comments) return;
      await api(`/tenders/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comments }) });
    } else {
      await api(`/tenders/${id}/approve`, { method: "POST" });
    }
    await loadApprovals();
    refreshChrome();
  } catch (err) {
    showResult(resultEl(), `Could not ${action} tender ${id}: ` + err.message, false);
  }
}
