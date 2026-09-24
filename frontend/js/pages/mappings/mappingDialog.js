import { api } from "../../api.js";
import { esc, kicker, stateTag, typeTag, fmtDateTime } from "../../kit.js";
import { mapAndApprove, approveMapping, rejectMapping, suspendMapping, reinstateMapping } from "./mappingActions.js";

// The detail dialog behind every matrix cell: facts, scope, versioned
// history, and the one set of actions valid for the mapping's current state.
// Clicking a cell never changes anything by itself -- every change happens
// from a button in here.
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");

const fmt = fmtDateTime;
const pill = (state) => stateTag(state || "none").replace(">NONE<", ">NOT MAPPED<");

export function closeMappingDialog() {
  overlay.hidden = true;
  box.innerHTML = "";
}

// opts: { data, vendor, kind: "category" | "item", target, mapping, onChanged }
//   target = the category object (kind "category") or the product (kind "item")
export async function openMappingDialog({ data, vendor, kind, target, mapping, onChanged }) {
  const isCategory = kind === "category";
  const type = target.procurement_type;
  const targetLabel = isCategory ? `the "${target.name}" category` : `"${target.name}"`;
  const minRating = isCategory
    ? target.min_mapping_rating
    : target.min_mapping_rating ?? data.categoryById.get(target.category_id)?.min_mapping_rating ?? null;
  const rating = data.ratingScore(vendor.id, type);

  const facts = [
    ["Procurement type", type],
    ["Mapping scope", isCategory ? "Whole category" : `Single item in ${target.category}`],
    ["Requested", mapping ? fmt(mapping.requested_at) : "—"],
    ["Last decision", mapping && mapping.decided_at ? fmt(mapping.decided_at) : "—"],
    ["Version", mapping ? mapping.version : "—"],
    ["Minimum rating to map", minRating != null ? `${minRating} (restricted)` : "None"],
    ["Vendor rating (" + type + ")", `${rating.toFixed(1)} / 100`],
    ["Vendor status", vendor.status.replace("_", " ")],
  ];

  // Items in scope: every item in the category (category dialog) or just this one.
  const items = isCategory ? data.products.filter((p) => p.category_id === target.id) : [target];
  const categoryApproved = (isCategory ? mapping : data.categoryMappingOf(vendor.id, target.category_id))?.state === "approved";
  const scopeRows = items
    .map((p) => {
      const m = data.itemMappingOf(vendor.id, p.id);
      const state = m ? m.state : categoryApproved ? "via category" : "—";
      return `<tr><td class="ep-cell ep-mono" style="font-size:11.5px">${esc(p.code)}</td><td class="ep-cell" style="font-size:12px">${esc(p.name)}</td><td class="ep-cell">${m ? pill(m.state) : `<span class="ep-sub">${state}</span>`}</td></tr>`;
    })
    .join("");

  let history = [];
  if (mapping) {
    try {
      history = (await api(`/mappings/${mapping.id}/history`)).slice().reverse();
    } catch (err) {
      history = [];
    }
  }

  const state = mapping ? mapping.state : null;
  const b = (label, act, primary) => `<button class="ep-b"${primary ? ' data-v="p"' : ""} data-act="${act}">${label}</button>`;
  const actions = {
    none: b("Map &amp; approve", "map", true),
    pending: b("Reject", "reject") + b("Approve", "approve", true),
    approved: b("Suspend mapping", "suspend", true),
    suspended: b("Reinstate", "reinstate", true),
    rejected: "",
  }[state || "none"];

  box.innerHTML = `
    <div class="dlg-head">
      <div style="flex:1">${kicker(`${isCategory ? "Category" : "Item"} mapping · ${type}`)}
        <h4>${esc(vendor.legal_name)} → ${esc(target.name)}</h4></div>
      ${pill(state)}
    </div>
    <div class="dlg-body">
      <div>
        <div class="fact-grid">${facts.map(([k, v]) => `<div>${kicker(k)}<div class="fact-value">${esc(v)}</div></div>`).join("")}</div>
        <div style="height:2px;background:rgba(32,30,29,.35);margin:15px 0 11px"></div>
        ${kicker("Mapping history")}
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:7px">${
          history.length
            ? history
                .map(
                  (h) => `<div class="hist"><div class="hist-when">${fmt(h.at)}</div>
                    <div style="font-size:12px;line-height:1.4">${h.from_state ? esc(h.from_state) + " → " : ""}<b>${esc(h.to_state)}</b>${h.reason ? ` — ${esc(h.reason)}` : ""}</div></div>`
                )
                .join("")
            : '<div class="hint">No history yet — this pair has never been mapped.</div>'
        }</div>
      </div>
      <div>
        ${kicker(isCategory ? "SKUs / items in scope" : "Item in scope")}
        <table class="ep-table" style="margin-top:7px"><thead><tr><th class="ep-th">Code</th><th class="ep-th">Entry</th><th class="ep-th">State</th></tr></thead><tbody>${scopeRows}</tbody></table>
        <div class="hint" style="margin-top:11px">Approving a category does not map every item in it as a separate record, but an approved category makes the vendor eligible for its items at tender time. An item mapping can add to that or suspend a single item.</div>
      </div>
    </div>
    <div class="dlg-foot">
      <div class="hint">This matrix is the single source of truth for who can be invited at tender time.</div>
      <button class="ep-b" data-act="close">Close</button>${actions}
    </div>`;
  overlay.hidden = false;

  const run = {
    map: () => mapAndApprove(vendor, isCategory ? { category_id: target.id } : { product_master_id: target.id }, targetLabel, { confirm: false }),
    approve: () => approveMapping(mapping),
    reject: () => rejectMapping(mapping),
    suspend: () => suspendMapping(mapping, vendor, targetLabel),
    reinstate: () => reinstateMapping(mapping, vendor, targetLabel),
  };
  box.querySelectorAll("button[data-act]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (btn.dataset.act === "close") return closeMappingDialog();
      closeMappingDialog();
      if (await run[btn.dataset.act]()) onChanged();
    })
  );
}

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeMappingDialog();
});
