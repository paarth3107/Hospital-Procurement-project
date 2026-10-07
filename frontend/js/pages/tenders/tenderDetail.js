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
// or the officer put it there. Clicking one opens a panel with its source and,
// on a Draft of a selective tender, a Remove vendor button that asks for a reason.
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
  const removed = p.removed_vendors
    .map(
      (r) => `<div class="ep-sub mt-6px">Removed: ${esc(r.legal_name)}. ${esc(r.reason)}${
        canEdit ? ` <button type="button" class="ep-link" data-restore="${p.line_item_id}:${r.vendor_id}">Restore</button>` : ""
      }</div>`
    )
    .join("");
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
  return `<div class="eligibility-line ${none ? "eligibility-none" : short ? "eligibility-short" : "eligibility-ok"}">
    <div class="d-flex justify-between gap-12px"><b class="fs-13px">${esc(p.product_name)}</b><span class="ep-sub">threshold ${p.threshold_applied}</span></div>
    ${
      none
        ? '<div class="fs-12px text-danger-700 mt-3px">Zero vendors qualified. This line is held back while the others go live, unless a vendor is invited below.</div>'
        : `<div class="d-flex flex-wrap gap-6px mt-6px">${chips}</div>${short ? `<div class="fs-12px text-warning mt-5px">Below the configured minimum of ${minInvites} vendor(s).</div>` : ""}`
    }
    <div class="vendor-panel" data-panel="${p.line_item_id}" hidden></div>
    ${removed}
    ${inviteRow}
  </div>`;
}

function wireLineControls(el, lines) {
  el.querySelectorAll("[data-chip]").forEach((b) =>
    b.addEventListener("click", () => {
      const [lineId, vendorId] = b.dataset.chip.split(":");
      const panel = el.querySelector(`[data-panel="${lineId}"]`);
      const line = lines.find((l) => String(l.line_item_id) === lineId);
      const v = line.eligible_vendors.find((x) => String(x.vendor_id) === vendorId);
      const why = (x) => (x.source === "guest" ? `Added by you: ${x.reason || ""}` : x.source === "open" ? "Open tender" : "Selected by the eligibility rules");
      panel.hidden = false;
      panel.innerHTML = `<div class="vendor-panel-body">
          <div class="ep-k">Remove from this line</div>
          <div class="d-flex flex-col gap-8px mt-10px">${line.eligible_vendors
            .map(
              (x) => `<label class="ep-check"><input type="checkbox" value="${x.vendor_id}" ${x.vendor_id === v.vendor_id ? "checked" : ""}> ${esc(x.legal_name)} <span class="ep-sub">${esc(why(x))}</span></label>`
            )
            .join("")}</div>
          <div class="d-flex gap-8px items-center flex-wrap mt-12px">
            <input class="input" data-remove-reason placeholder="Reason for removing">
            <button type="button" class="ep-b" data-remove-confirm>Remove selected</button>
            <button type="button" class="ep-b" data-remove-cancel>Cancel</button>
          </div>
        </div>`;
      panel.querySelector("[data-remove-cancel]").addEventListener("click", () => (panel.hidden = true));
      panel.querySelector("[data-remove-confirm]").addEventListener("click", async () => {
        const ids = [...panel.querySelectorAll('input[type="checkbox"]:checked')].map((c) => Number(c.value));
        const reason = panel.querySelector("[data-remove-reason]").value.trim();
        if (!ids.length) return modalAlert("Tick at least one vendor to remove.");
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
      });
    })
  );
  el.querySelectorAll("[data-restore]").forEach((b) =>
    b.addEventListener("click", async () => {
      const [lineId, vendorId] = b.dataset.restore.split(":");
      try {
        await api(`/tenders/${tenderId}/lines/${lineId}/vendor-removals/${vendorId}`, { method: "DELETE" });
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
    wireLineControls(el, preview);
  } catch (err) {
    el.textContent = "Could not load eligibility preview: " + err.message;
  }
}

document.getElementById("preview-eligibility-btn").addEventListener("click", renderPreview);
