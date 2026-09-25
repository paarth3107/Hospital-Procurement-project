import { esc, kicker, fmtDateTime } from "../../kit.js";

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
    ? `<table class="ep-table" style="margin-top:6px"><tbody>${Object.entries(obj)
        .map(([k, v]) => `<tr><td class="ep-cell ep-sub" style="width:34%">${esc(k.replace(/_/g, " "))}</td><td class="ep-cell" style="font-size:12.5px;white-space:pre-wrap;word-break:break-word">${esc(pretty(v))}</td></tr>`)
        .join("")}</tbody></table>`
    : '<div class="ep-sub" style="margin-top:6px">—</div>';

export function openAuditDetail(row) {
  const who = row.actor_type === "system" ? "System" : `${row.actor_name || "—"}${row.actor_role ? ` (${row.actor_role.replace(/_/g, " ")})` : ""}`;
  box.innerHTML = `
    <div class="dlg-head"><div style="flex:1">${kicker(`Audit entry #${row.id}${row.imported ? " · imported from earlier history" : ""}`)}<h4>${esc(actionLabel(row.action))}</h4></div></div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:14px;max-height:70vh;overflow:auto">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>${kicker("When")}<div style="font-weight:600;margin-top:3px">${esc(fmtDateTime(row.occurred_at))}</div></div>
        <div>${kicker("Who")}<div style="font-weight:600;margin-top:3px">${esc(who)}</div></div>
        <div>${kicker("Record")}<div style="font-weight:600;margin-top:3px">${esc(row.entity_type)}${row.entity_id != null ? ` #${row.entity_id}` : ""}${row.entity_label ? ` — ${esc(row.entity_label)}` : ""}</div></div>
        <div>${kicker("Facility")}<div style="font-weight:600;margin-top:3px">${row.facility_id ?? "—"}</div></div>
      </div>
      ${row.reason ? `<div>${kicker("Reason / comment")}<div style="margin-top:3px;white-space:pre-wrap">${esc(row.reason)}</div></div>` : ""}
      <div>${kicker("Before")}${kv(row.before_state)}</div>
      <div>${kicker("After")}${kv(row.after_state)}</div>
      ${row.meta ? `<div>${kicker("Context")}${kv(row.meta)}</div>` : ""}
    </div>
    <div style="padding:12px 18px;display:flex;justify-content:flex-end"><button class="ep-b" data-v="p" id="audit-close">Close</button></div>`;
  overlay.hidden = false;
  box.querySelector("#audit-close").addEventListener("click", () => {
    overlay.hidden = true;
    box.innerHTML = "";
  });
}
