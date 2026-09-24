import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, stateTag, emptyRow, tag } from "../../kit.js";

// Below the form, for a saved tender: which lines are live vs held back, a
// preview of who the system would currently invite per line, and the
// approval rounds.
let tenderId = null;
let tenderState = null;

const detail = () => document.getElementById("tender-detail");

export function showTenderDetail(id, tenderStatus) {
  tenderId = id;
  tenderState = tenderStatus;
  detail().hidden = false;
  document.getElementById("eligibility-preview").innerHTML = "Preview shows who would be invited for the saved version.";
  loadRounds();
  loadPublishStatus();
}

export function hideTenderDetail() {
  detail().hidden = true;
  tenderId = null;
}

// For a Published tender: which lines are live and which are held back (no
// eligible vendor at approval time). A held line can be published later.
async function loadPublishStatus() {
  const wrap = document.getElementById("tender-publish-status");
  wrap.hidden = tenderState !== "published";
  if (wrap.hidden) return;
  const tbody = wrap.querySelector("tbody");
  const [lines, products] = await Promise.all([api(`/tenders/${tenderId}/line-items`), api("/products")]);
  const name = new Map(products.map((p) => [p.id, p.name]));
  tbody.innerHTML = lines
    .map(
      (li) => `<tr><td class="ep-cell" style="font-weight:600">${esc(name.get(li.product_master_id) || "#" + li.product_master_id)}</td>
        <td class="ep-cell">${li.published ? tag("Published", "pos") : tag("Held back", "att")}</td>
        <td class="ep-cell" style="text-align:right">${li.published ? "" : `<button class="ep-b" data-v="p" data-line-id="${li.id}">Publish now</button>`}</td></tr>`
    )
    .join("");
}

document.querySelector("#publish-status-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-line-id]");
  if (!btn) return;
  const resultEl = document.getElementById("tender-result");
  try {
    await api(`/tenders/${tenderId}/line-items/${btn.dataset.lineId}/publish`, { method: "POST" });
    showResult(resultEl, "Line published to its eligible vendors.", true);
    loadPublishStatus();
  } catch (err) {
    showResult(resultEl, "Could not publish line: " + err.message, false);
  }
});

async function loadRounds() {
  const tbody = document.querySelector("#round-table tbody");
  const rounds = await api(`/tenders/${tenderId}/approval-rounds`);
  tbody.innerHTML = rounds.length
    ? rounds
        .slice()
        .reverse()
        .map(
          (r) => `<tr><td class="ep-cell">${r.round_number}</td><td class="ep-cell">${stateTag(r.decision)}</td>
            <td class="ep-cell">Tier ${r.required_tier}</td><td class="ep-cell">${esc(r.comments || "")}</td></tr>`
        )
        .join("")
    : emptyRow(4, "Not submitted yet.");
}

// Filter-chain style preview: one block per line with its eligible vendors.
document.getElementById("preview-eligibility-btn").addEventListener("click", async () => {
  const el = document.getElementById("eligibility-preview");
  try {
    const preview = await api(`/tenders/${tenderId}/eligibility-preview`);
    el.innerHTML = preview
      .map((p) => {
        const none = p.eligible_vendors.length === 0;
        return `<div style="border-left:3px solid ${none ? "#ec3013" : "rgba(32,30,29,.4)"};padding:8px 12px;margin-bottom:10px;background:${none ? "rgba(236,48,19,.08)" : "rgba(32,30,29,.04)"}">
          <div style="display:flex;justify-content:space-between;gap:12px"><b style="font-size:13px">${esc(p.product_name)}</b><span class="ep-sub">threshold ${p.threshold_applied}</span></div>
          ${
            none
              ? '<div style="font-size:12px;color:#ae1800;margin-top:3px">Zero vendors qualified — this line would be held back while the others go live.</div>'
              : `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${p.eligible_vendors.map((v) => `<span class="ep-tag">${esc(v.legal_name)} · ${v.rating_score.toFixed(0)}</span>`).join("")}</div>`
          }
        </div>`;
      })
      .join("");
  } catch (err) {
    el.textContent = "Could not load eligibility preview: " + err.message;
  }
});
