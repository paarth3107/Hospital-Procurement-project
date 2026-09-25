import { API_BASE, api, apiHeaders } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, tag, th, emptyRow, fmtDateTime } from "../../kit.js";
import { openAuditDetail, actionLabel } from "./auditDetail.js";

// ---- Audit log (System Admin, read-only): every recorded action with who,
// what, when and why. Filterable, paginated, exportable to CSV. ----
const root = () => document.getElementById("audit-root");
const resultEl = () => document.getElementById("audit-result");

const EMPTY = { entity_type: "", action: "", actor_type: "", date_from: "", date_to: "", search: "" };
let filters = { ...EMPTY };
let page = 1;
let data = { items: [], total: 0, page_size: 50 };
let options = { entity_types: [], actions: [] };

const query = (extra = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v !== "" && v != null) p.set(k, v);
  return p.toString();
};

function summary(row) {
  if (row.reason) return row.reason;
  const a = row.after_state;
  if (a && a.status) return `→ ${String(a.status).replace(/_/g, " ")}`;
  if (a && a.state) return `→ ${a.state}`;
  return "";
}

function render() {
  const select = (name, label, values, current) =>
    `<select class="input" style="width:auto" data-f="${name}"><option value="">${label}</option>${values
      .map(([v, l]) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(l)}</option>`)
      .join("")}</select>`;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const rows = data.items.length
    ? data.items
        .map(
          (r) => `<tr>
            <td class="ep-cell" style="font-size:12px;white-space:nowrap">${esc(fmtDateTime(r.occurred_at))}</td>
            <td class="ep-cell"><div style="font-weight:600">${esc(r.actor_type === "system" ? "System" : r.actor_name || "—")}</div><div class="ep-sub">${esc((r.actor_role || r.actor_type).replace(/_/g, " "))}</div></td>
            <td class="ep-cell">${esc(actionLabel(r.action))}${r.imported ? ` ${tag("imported")}` : ""}</td>
            <td class="ep-cell"><div style="font-weight:600">${esc(r.entity_label || `${r.entity_type} #${r.entity_id ?? ""}`)}</div><div class="ep-sub">${esc(r.entity_type)}${r.entity_id != null ? ` #${r.entity_id}` : ""}</div></td>
            <td class="ep-cell ep-sub" style="max-width:280px">${esc(summary(r))}</td>
            <td class="ep-cell" style="text-align:right"><button class="ep-b" data-detail="${r.id}">Details</button></td>
          </tr>`
        )
        .join("")
    : emptyRow(6, "No entries match these filters.");
  root().innerHTML = `<div class="ep-pane">
    <div class="ep-pane-head"><span>Audit log</span><span class="ep-k">${data.total} entries · read-only</span></div>
    <div style="padding:12px 14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;border-bottom:1px solid rgba(32,30,29,.18)">
      ${select("entity_type", "All record types", options.entity_types.map((v) => [v, v]), filters.entity_type)}
      ${select("action", "All actions", options.actions.map((v) => [v, actionLabel(v)]), filters.action)}
      ${select("actor_type", "Anyone", [["staff", "Staff"], ["vendor", "Vendors"], ["system", "System"], ["anonymous", "Not signed in"]], filters.actor_type)}
      <label class="ep-sub">From <input class="input" style="width:auto" type="date" data-f="date_from" value="${esc(filters.date_from)}"></label>
      <label class="ep-sub">To <input class="input" style="width:auto" type="date" data-f="date_to" value="${esc(filters.date_to)}"></label>
      <input class="input" data-f="search" placeholder="Search name, record or reason" value="${esc(filters.search)}" style="width:auto;flex:1;min-width:210px">
      <button class="ep-b" data-v="p" id="audit-apply">Apply</button>
      <button class="ep-b" id="audit-reset">Reset</button>
      <button class="ep-b" id="audit-export" style="margin-left:auto">Export CSV</button>
    </div>
    <table class="ep-table">${th("When", "Who", "Action", "Record", "Reason / change", "")}<tbody>${rows}</tbody></table>
    <div style="padding:10px 14px;display:flex;gap:10px;align-items:center;justify-content:flex-end">
      <span class="ep-sub">Page ${page} of ${pages}</span>
      <button class="ep-b" id="audit-prev" ${page <= 1 ? "disabled" : ""}>Previous</button>
      <button class="ep-b" id="audit-next" ${page >= pages ? "disabled" : ""}>Next</button>
    </div>
  </div>`;

  const r = root();
  const readFilters = () => r.querySelectorAll("[data-f]").forEach((el) => (filters[el.dataset.f] = el.value));
  r.querySelector("#audit-apply").addEventListener("click", () => {
    readFilters();
    page = 1;
    load();
  });
  r.querySelector("[data-f='search']").addEventListener("keydown", (e) => e.key === "Enter" && r.querySelector("#audit-apply").click());
  r.querySelector("#audit-reset").addEventListener("click", () => {
    filters = { ...EMPTY };
    page = 1;
    load();
  });
  r.querySelector("#audit-prev").addEventListener("click", () => {
    page--;
    load();
  });
  r.querySelector("#audit-next").addEventListener("click", () => {
    page++;
    load();
  });
  r.querySelector("#audit-export").addEventListener("click", exportCsv);
  r.querySelectorAll("[data-detail]").forEach((b) => b.addEventListener("click", () => openAuditDetail(data.items.find((x) => x.id === Number(b.dataset.detail)))));
}

async function exportCsv() {
  try {
    const res = await fetch(`${API_BASE}/audit-log/export?${query()}`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not export");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showResult(resultEl(), err.message, false);
  }
}

async function load() {
  try {
    [data, options] = await Promise.all([api(`/audit-log?${query({ page, page_size: 50 })}`), api("/audit-log/filters")]);
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load the audit log: " + err.message, false);
  }
}

export const loadAuditLog = () => load();
