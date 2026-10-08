import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, stateTag, emptyRow, tag } from "../../kit.js";
import { modalAlert } from "../../modal.js";
import { state } from "../../state.js";

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
  loadRounds();
  loadPublishStatus();
  renderPreview();
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
  document.getElementById("force-close-bidding-btn").hidden = wrap.hidden || state.user?.role !== "system_admin";
  if (wrap.hidden) return;
  const tbody = wrap.querySelector("tbody");
  const [lines, products] = await Promise.all([api(`/tenders/${tenderId}/line-items`), api("/products")]);
  const name = new Map(products.map((p) => [p.id, p.name]));
  tbody.innerHTML = lines
    .map(
      (li) => `<tr><td class="ep-cell fw-600">${esc(name.get(li.product_master_id) || "#" + li.product_master_id)}</td>
        <td class="ep-cell">${li.published ? tag("Published", "pos") : tag("Held back", "att")}</td>
        <td class="ep-cell text-right">${li.published ? "" : `<button class="ep-b" data-v="p" data-line-id="${li.id}">Publish now</button>`}</td></tr>`
    )
    .join("");
}

document.getElementById("force-close-bidding-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("tender-result");
  try {
    await api(`/tenders/${tenderId}/force-close-bidding`, { method: "POST" });
    showResult(resultEl, "Bidding force-closed for this tender (demo utility — not a real deadline pass).", true);
    document.getElementById("force-close-bidding-btn").hidden = true;
  } catch (err) {
    showResult(resultEl, "Could not force-close bidding: " + err.message, false);
  }
});

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

// Filter-chain style preview: one block per line with its eligible vendors, plus
// the officer's guest invites with their reasons (2026-10-06).
// Every vendor on a line shows the same way, whether the rules, the open tender
// or the officer put it there. On a Draft of a selective tender, clicking a
// chip marks it for removal (2026-10-08, was "opens a panel to re-pick who to
// remove") -- click as many as you want, each one highlights, then Remove
// selected vendors / Cancel appear right below the row.
function lineHtml(p, { minInvites, canEdit, activeVendors }) {
  const none = p.eligible_vendors.length === 0;
  const short = !none && minInvites && p.eligible_vendors.length < minInvites;
  const invitedIds = new Set(p.eligible_vendors.map((v) => v.vendor_id));
  const chips = p.eligible_vendors
    .map((v) => {
      const label = `${esc(v.legal_name)} · ${v.rating_score.toFixed(0)}`;
      return canEdit
        ? `<button type="button" class="ep-tag ep-tag-action" data-chip="${p.line_item_id}:${v.vendor_id}">${label}</button>`
        : `<span class="ep-tag">${label}</span>`;
    })
    .join("");
  // No Restore button (2026-10-08) -- a removed vendor can just be invited
  // again from the dropdown below, same as anyone else.
  const removed = p.removed_vendors.map((r) => `<div class="ep-sub mt-6px">Removed: ${esc(r.legal_name)}. ${esc(r.reason)}</div>`).join("");
  const candidates = activeVendors.filter((v) => !invitedIds.has(v.id));
  const inviteRow =
    canEdit && candidates.length
      ? `<div class="invite-row d-flex gap-8px items-center flex-wrap mt-10px">
          <select class="input" data-guest-vendor="${p.line_item_id}"><option value="">Invite a vendor</option>${candidates
            .map((v) => `<option value="${v.id}">${esc(v.legal_name)}</option>`)
            .join("")}</select>
          <input class="input" data-guest-reason="${p.line_item_id}" placeholder="Reason">
          <button type="button" class="ep-b" data-guest-add="${p.line_item_id}">Invite</button>
        </div>`
      : "";
  const removeBar = canEdit
    ? `<div class="d-flex gap-8px items-center flex-wrap mt-10px" data-remove-bar="${p.line_item_id}" hidden>
        <span class="ep-sub" data-remove-count="${p.line_item_id}">0 selected</span>
        <input class="input" data-remove-reason="${p.line_item_id}" placeholder="Reason for removing">
        <button type="button" class="ep-b" data-v="p" data-remove-confirm="${p.line_item_id}">Remove selected vendors</button>
        <button type="button" class="ep-b" data-remove-cancel="${p.line_item_id}">Cancel</button>
      </div>`
    : "";
  return `<div class="eligibility-line ${none ? "eligibility-none" : short ? "eligibility-short" : "eligibility-ok"}">
    <div class="d-flex justify-between gap-12px"><b class="fs-13px">${esc(p.product_name)}</b><span class="ep-sub">threshold ${p.threshold_applied}</span></div>
    ${
      none
        ? '<div class="fs-12px text-danger-700 mt-3px">Zero vendors qualified. This line is held back while the others go live, unless a vendor is invited below.</div>'
        : `<div class="d-flex flex-wrap gap-6px mt-6px" data-chip-row="${p.line_item_id}">${chips}</div>${short ? `<div class="fs-12px text-warning mt-5px">Below the configured minimum of ${minInvites} vendor(s).</div>` : ""}`
    }
    ${removeBar}
    ${removed}
    ${inviteRow}
  </div>`;
}

function wireLineControls(el) {
  const marked = new Map(); // lineId (string) -> Set<vendorId>

  function updateBar(lineId) {
    const bar = el.querySelector(`[data-remove-bar="${lineId}"]`);
    if (!bar) return;
    const count = marked.get(lineId)?.size || 0;
    bar.hidden = count === 0;
    bar.querySelector(`[data-remove-count="${lineId}"]`).textContent = `${count} selected`;
  }

  el.querySelectorAll("[data-chip]").forEach((b) =>
    b.addEventListener("click", () => {
      const [lineId, vendorId] = b.dataset.chip.split(":");
      const vid = Number(vendorId);
      if (!marked.has(lineId)) marked.set(lineId, new Set());
      const set = marked.get(lineId);
      if (set.has(vid)) {
        set.delete(vid);
        b.classList.remove("marked-remove");
      } else {
        set.add(vid);
        b.classList.add("marked-remove");
      }
      updateBar(lineId);
    })
  );
  el.querySelectorAll("[data-remove-cancel]").forEach((b) =>
    b.addEventListener("click", () => {
      const lineId = b.dataset.removeCancel;
      marked.set(lineId, new Set());
      el.querySelectorAll(`[data-chip-row="${lineId}"] [data-chip]`).forEach((c) => c.classList.remove("marked-remove"));
      el.querySelector(`[data-remove-reason="${lineId}"]`).value = "";
      updateBar(lineId);
    })
  );
  el.querySelectorAll("[data-remove-confirm]").forEach((b) =>
    b.addEventListener("click", async () => {
      const lineId = b.dataset.removeConfirm;
      const ids = [...(marked.get(lineId) || [])];
      const reason = el.querySelector(`[data-remove-reason="${lineId}"]`).value.trim();
      if (!ids.length) return modalAlert("Click a vendor's chip to select it for removal.");
      if (!reason) return modalAlert("Give a reason. The removal is kept on record.");
      try {
        await api(`/tenders/${tenderId}/lines/${lineId}/vendor-removals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendor_ids: ids, reason }),
        });
        renderPreview();
      } catch (err) {
        modalAlert(err.message);
      }
    })
  );
  el.querySelectorAll("[data-guest-add]").forEach((b) =>
    b.addEventListener("click", async () => {
      const lineId = b.dataset.guestAdd;
      const vendorId = el.querySelector(`[data-guest-vendor="${lineId}"]`).value;
      const reason = el.querySelector(`[data-guest-reason="${lineId}"]`).value.trim();
      if (!vendorId) return modalAlert("Choose a vendor to invite.");
      if (!reason) return modalAlert("Give a reason. Guests are invited outside the eligibility rules, so the reason is kept on record.");
      try {
        await api(`/tenders/${tenderId}/lines/${lineId}/guest-invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendor_id: Number(vendorId), reason }),
        });
        renderPreview();
      } catch (err) {
        modalAlert(err.message);
      }
    })
  );
}

async function renderPreview() {
  const el = document.getElementById("eligibility-preview");
  // Read the saved tender's own min_invites -- spec §6.2 names the field but never
  // describes enforcement (only Maximum has one, §6.5 point 5), so this is shown as
  // a soft heads-up, not a block.
  const minInvitesField = document.querySelector('#tender-form [name="min_invites"]');
  const minInvites = minInvitesField?.value ? Number(minInvitesField.value) : null;
  try {
    const [tender, preview, vendors] = await Promise.all([
      api(`/tenders/${tenderId}`),
      api(`/tenders/${tenderId}/eligibility-preview`),
      api("/vendors/lookup"),
    ]);
    const activeVendors = vendors.filter((v) => v.status === "active");
    const canEdit = tender.status === "draft" && !tender.open_tender;
    el.innerHTML = tender.open_tender
      ? '<div class="ep-note mb-10px">Open tender: every Active vendor is invited on every line.</div>' +
        preview.map((p) => lineHtml(p, { minInvites, canEdit, activeVendors })).join("")
      : preview.map((p) => lineHtml(p, { minInvites, canEdit, activeVendors })).join("");
    wireLineControls(el);
  } catch (err) {
    el.textContent = "Could not load eligibility preview: " + err.message;
  }
}

