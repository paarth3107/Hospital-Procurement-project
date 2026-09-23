import { api } from "../api.js";
import { showResult } from "../ui.js";
import { switchView } from "../nav.js";

// ---- Staff Dashboard ----
export async function loadDashboard() {
  const resultEl = document.getElementById("dashboard-result");
  try {
    const stats = await api("/dashboard/stats");
    document.getElementById("stat-open-tenders").textContent = stats.open_tenders_count;
    document.getElementById("stat-pending-approval").textContent = stats.pending_approval_count;
    document.getElementById("stat-vendors-pending").textContent = stats.vendors_pending_count;
    document.getElementById("stat-bids-submitted").textContent = stats.bids_submitted_count;
    document.getElementById("stat-registered-vendors").textContent = stats.registered_vendors_count;

    const openBody = document.querySelector("#dashboard-open-tenders-table tbody");
    openBody.innerHTML = stats.open_tenders.length
      ? ""
      : '<tr><td colspan="4" style="color:#888;">No tenders currently open for bidding.</td></tr>';
    for (const t of stats.open_tenders) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${t.title}</td><td>${t.department || "—"}</td><td>${t.bids_received}</td><td>${t.bid_due_date ? new Date(t.bid_due_date).toLocaleString() : "—"}</td>`;
      openBody.appendChild(tr);
    }

    const pendingBody = document.querySelector("#dashboard-pending-approval-table tbody");
    pendingBody.innerHTML = stats.pending_approval.length
      ? ""
      : '<tr><td colspan="4" style="color:#888;">Nothing pending your approval.</td></tr>';
    for (const t of stats.pending_approval) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${t.title}</td><td>${t.round_number}</td><td>${t.required_tier}</td><td class="row-actions"><button data-id="${t.id}">Review →</button></td>`;
      pendingBody.appendChild(tr);
    }

    const recentBody = document.querySelector("#dashboard-recent-published-table tbody");
    recentBody.innerHTML = stats.recently_published.length
      ? ""
      : '<tr><td colspan="2" style="color:#888;">Nothing published yet.</td></tr>';
    for (const t of stats.recently_published) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${t.title}</td><td>${t.published_at ? new Date(t.published_at).toLocaleString() : "—"}</td>`;
      recentBody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}

document.querySelector("#dashboard-pending-approval-table tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  switchView("approvals");
});
