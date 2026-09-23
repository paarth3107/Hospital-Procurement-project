import { api } from "../api.js";
import { showResult } from "../ui.js";

// ---- Vendor rating ----
let currentRatingVendorId = null;

// Every vendor (any status) shows up here — a rating can still be looked up
// for a vendor that's since been suspended, unlike the Mapping picker which
// is deliberately Active-only.
export async function populateRatingPicker() {
  const select = document.querySelector('#rating-lookup-form select[name="vendor_id"]');
  try {
    const vendors = await api("/vendors/lookup");
    select.innerHTML =
      '<option value="">— select a vendor —</option>' +
      vendors.map((v) => `<option value="${v.id}">${v.legal_name} (#${v.id})</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("rating-result"), "Could not load vendor picker: " + err.message, false);
  }
}

// Fleet-wide overview: stat cards + a leaderboard sorted by score, so
// there's something to look at before picking one vendor -- same
// list-first idea as the Vendor Mapping matrix, applied here with real
// aggregate numbers instead of a lookup-only form.
export async function renderRatingDashboard() {
  const el = document.getElementById("rating-dashboard");
  try {
    const vendors = await api("/vendors/lookup");
    const ratings = await Promise.all(vendors.map((v) => api(`/ratings/${v.id}`).catch(() => null)));
    const rows = vendors.map((v, i) => ({ vendor: v, rating: ratings[i] })).filter((r) => r.rating);

    if (rows.length === 0) {
      el.innerHTML = '<p class="hint">No vendors to rate yet.</p>';
      return;
    }

    const avgScore = rows.reduce((sum, r) => sum + r.rating.overall_score, 0) / rows.length;
    const provisionalCount = rows.filter((r) => r.rating.is_provisional).length;
    const staleCount = rows.filter((r) => r.rating.is_stale).length;
    const top = rows.slice().sort((a, b) => b.rating.overall_score - a.rating.overall_score)[0];

    el.innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="stat-label">Vendors Rated</div><div class="stat-value">${rows.length}</div></div>
        <div class="stat-card"><div class="stat-label">Average Score</div><div class="stat-value">${avgScore.toFixed(1)}</div></div>
        <div class="stat-card"><div class="stat-label">Top Rated</div><div class="stat-value accent" style="font-size:16px;">${top.vendor.legal_name}</div></div>
        <div class="stat-card"><div class="stat-label">Provisional</div><div class="stat-value">${provisionalCount}</div></div>
        <div class="stat-card"><div class="stat-label">Stale — Update Due</div><div class="stat-value">${staleCount}</div></div>
      </div>
      <table id="rating-leaderboard">
        <thead><tr><th>Vendor</th><th>Overall Score</th><th>Status</th></tr></thead>
        <tbody></tbody>
      </table>`;

    const tbody = el.querySelector("#rating-leaderboard tbody");
    for (const { vendor, rating } of rows.slice().sort((a, b) => b.rating.overall_score - a.rating.overall_score)) {
      const badges = [
        rating.is_provisional ? '<span class="badge badge-provisional">Provisional</span>' : "",
        rating.is_stale ? '<span class="badge badge-stale">Stale — Update Due</span>' : "",
      ]
        .filter(Boolean)
        .join(" ");
      const tr = document.createElement("tr");
      tr.dataset.vendorId = vendor.id;
      tr.innerHTML = `<td>${vendor.legal_name} <span style="color:#888;">(#${vendor.id})</span></td><td>${rating.overall_score.toFixed(1)}</td><td>${badges || "—"}</td>`;
      tbody.appendChild(tr);
    }
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-vendor-id]");
      if (!tr) return;
      currentRatingVendorId = Number(tr.dataset.vendorId);
      document.querySelector('#rating-lookup-form select[name="vendor_id"]').value = currentRatingVendorId;
      loadRating();
    });
  } catch (err) {
    el.innerHTML = `<div class="result err">Could not load rating dashboard: ${err.message}</div>`;
  }
}

document.getElementById("rating-lookup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const vendorId = Number(new FormData(e.target).get("vendor_id"));
  currentRatingVendorId = vendorId;
  await loadRating();
});

async function loadRating() {
  const resultEl = document.getElementById("rating-result");
  const card = document.getElementById("rating-card");
  try {
    const rating = await api(`/ratings/${currentRatingVendorId}`);
    const vendors = await api("/vendors/lookup");
    const vendor = vendors.find((v) => v.id === currentRatingVendorId);
    const fmt = (v) => (v === null || v === undefined ? "— not entered —" : `${v}%`);

    document.getElementById("rating-header").innerHTML = `
      <div>
        <div style="font-size:13px; color:#888;">Vendor Rating</div>
        <div style="font-size:20px; font-weight:700; margin-top:2px;">${vendor ? vendor.legal_name : "Vendor #" + currentRatingVendorId}</div>
      </div>
      <div class="score-block">
        <div class="score-label">Overall Weighted Score</div>
        <div class="score-value">${rating.overall_score.toFixed(1)} / 100</div>
        ${rating.is_provisional ? '<span class="badge badge-provisional">Provisional</span>' : ""}
        ${rating.is_stale ? '<span class="badge badge-stale">Stale — Update Due</span>' : ""}
      </div>`;

    document.getElementById("rating-breakdown").innerHTML = `
      <div class="rating-cards-row">
        <div class="rating-card-box">
          <div class="card-title-row"><span>Price Competitiveness — 20% weight</span><span class="badge badge-auto">Auto-calculated</span></div>
          <div class="card-score">${rating.price_competitiveness.toFixed(1)}</div>
          <p class="hint">System-computed from bid history (rolling 12 months). No bid-evaluation history exists yet, so this stays at its provisional default until Phase 5/6 feed it real data.</p>
        </div>
        <div class="rating-card-box">
          <div class="card-title-row"><span>Manually Entered Parameters</span><span class="badge badge-manual">Manual</span></div>
          <div class="rating-param-row"><span>On-time Delivery — 25% weight</span><span>${fmt(rating.on_time_pct)}</span></div>
          <div class="rating-param-row"><span>Quality Acceptance Rate — 25% weight</span><span>${fmt(rating.quality_pct)}</span></div>
          <div class="rating-param-row"><span>Compliance / Documentation — 15% weight</span><span>${fmt(rating.compliance_pct)}</span></div>
          <div class="rating-param-row"><span>Responsiveness — 15% weight</span><span>${fmt(rating.responsiveness)}</span></div>
          <p class="hint">Last manual update: ${rating.last_manual_update_at ? new Date(rating.last_manual_update_at).toLocaleString() : "never"}</p>
        </div>
      </div>`;

    const history = await api(`/ratings/${currentRatingVendorId}/history`);
    const historyBody = document.querySelector("#rating-history-table tbody");
    historyBody.innerHTML = history.length
      ? ""
      : '<tr><td colspan="5" style="color:#888;">No manual entries yet.</td></tr>';
    for (const h of history.slice().reverse()) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${h.field}</td><td>${h.old_value ?? "—"}</td><td>${h.new_value}</td><td>${h.comment || ""}</td><td>${h.entered_at}</td>`;
      historyBody.appendChild(tr);
    }
    card.hidden = false;
    resultEl.textContent = "";
  } catch (err) {
    card.hidden = true;
    showResult(resultEl, "Could not load rating: " + err.message, false);
  }
}

document.getElementById("rating-update-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {};
  for (const field of ["on_time_pct", "quality_pct", "compliance_pct", "responsiveness"]) {
    if (data[field] !== "") payload[field] = Number(data[field]);
  }
  if (data.comment) payload.comment = data.comment;
  const resultEl = document.getElementById("rating-result");
  try {
    await api(`/ratings/${currentRatingVendorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showResult(resultEl, "Manual ratings saved.", true);
    form.reset();
    loadRating();
    renderRatingDashboard();
  } catch (err) {
    showResult(resultEl, "Could not save ratings: " + err.message, false);
  }
});
