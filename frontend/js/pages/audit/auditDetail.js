import { esc, kicker, fmtDateTime, roleLabel } from "../../kit.js";

// One audit entry in full: who / what / when, the reason, and the before and
// after values (only the fields that changed are recorded).
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");

export const actionLabel = (action) => {
  const [domain, ...rest] = action.split(".");
  const verb = rest.join(".").replace(/_/g, " ");
  return `${domain} · ${verb}`;
};

const pretty = (value) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 1).replace(/[{}"]/g, "").trim() || "—";
  return String(value);
};

const kv = (obj) =>
  obj && Object.keys(obj).length
    ? `<table class="ep-table mt-6px"><tbody>${Object.entries(obj)
        .map(([k, v]) => `<tr><td class="ep-cell ep-sub w-34pct">${esc(k.replace(/_/g, " "))}</td><td class="ep-cell fs-12-5px pre-wrap break-word">${esc(pretty(v))}</td></tr>`)
        .join("")}</tbody></table>`
    : '<div class="ep-sub mt-6px">—</div>';

export function openAuditDetail(row) {
  const who = row.actor_type === "system" ? "System" : `${row.actor_name || "—"}${row.actor_role ? ` (${roleLabel(row.actor_role)})` : ""}`;
  box.innerHTML = `
    <div class="dlg-head"><div class="flex-1">${kicker(`Audit entry #${row.id}${row.imported ? " · imported from earlier history" : ""}`)}<h4>${esc(actionLabel(row.action))}</h4></div></div>
    <div class="padding-16px-18px d-flex flex-col gap-14px maxh-70vh overflow-auto">
      <div class="d-grid grid-cols-1fr-1fr gap-12px">
        <div>${kicker("When")}<div class="fw-600 mt-3px">${esc(fmtDateTime(row.occurred_at))}</div></div>
        <div>${kicker("Who")}<div class="fw-600 mt-3px">${esc(who)}</div></div>
        <div>${kicker("Record")}<div class="fw-600 mt-3px">${esc(row.entity_type)}${row.entity_id != null ? ` #${row.entity_id}` : ""}${row.entity_label ? ` — ${esc(row.entity_label)}` : ""}</div></div>
        <div>${kicker("Facility")}<div class="fw-600 mt-3px">${row.facility_id ?? "—"}</div></div>
      </div>
      ${row.reason ? `<div>${kicker("Reason / comment")}<div class="mt-3px pre-wrap">${esc(row.reason)}</div></div>` : ""}
      <div>${kicker("Before")}${kv(row.before_state)}</div>
      <div>${kicker("After")}${kv(row.after_state)}</div>
      ${row.meta ? `<div>${kicker("Context")}${kv(row.meta)}</div>` : ""}
    </div>
    <div class="padding-12px-18px d-flex justify-end"><button class="ep-b" data-v="p" id="audit-close">Close</button></div>`;
  overlay.hidden = false;
  box.querySelector("#audit-close").addEventListener("click", () => {
    overlay.hidden = true;
    box.innerHTML = "";
  });
}
