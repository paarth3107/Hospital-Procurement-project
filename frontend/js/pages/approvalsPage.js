import { api } from "../api.js";
import { showResult } from "../ui.js";
import { modalPrompt } from "../modal.js";

// ---- E-Tender Approval ----
export async function loadApprovals() {
  const tbody = document.querySelector("#approval-table tbody");
  const resultEl = document.getElementById("approval-result");
  try {
    const tenders = await api("/tenders?status_filter=pending_approval");
    tbody.innerHTML = "";
    if (tenders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#888;">Nothing pending approval.</td></tr>';
    }
    for (const t of tenders) {
      const rounds = await api(`/tenders/${t.id}/approval-rounds`);
      const current = rounds.find((r) => r.round_number === t.round_number);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.id}</td>
        <td>${t.title}</td>
        <td>${t.round_number}</td>
        <td>${current ? current.required_tier : "—"}</td>
        <td class="row-actions">
          <button class="approve" data-id="${t.id}" data-action="approve">Approve &amp; Publish</button>
          <button class="reject" data-id="${t.id}" data-action="reject">Reject</button>
        </td>`;
      tbody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load approval queue: " + err.message, false);
  }
}

document.getElementById("approvals-refresh-btn").addEventListener("click", loadApprovals);

document.querySelector("#approval-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { id, action } = btn.dataset;
  const resultEl = document.getElementById("approval-result");
  try {
    if (action === "reject") {
      const comments = await modalPrompt("Comments for rejection (required):");
      if (!comments) return;
      await api(`/tenders/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments }),
      });
    } else {
      await api(`/tenders/${id}/approve`, { method: "POST" });
    }
    loadApprovals();
  } catch (err) {
    showResult(resultEl, `Could not ${action} tender ${id}: ` + err.message, false);
  }
});
