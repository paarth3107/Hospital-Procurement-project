import { API_BASE, api, apiHeaders } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, tag, emptyRow, fmtDateTime, roleLabel } from "../../kit.js";
import { openAuditDetail, actionLabel } from "./auditDetail.js";

// Fixed column widths in px (2026-10-08) -- table-layout: fixed, scoped to
// this table only via .audit-table so every other .ep-table keeps
// auto-sizing. These are ratios the table scales to fit 100% of its
// container, not literal sizes, so columns stay proportionate to each other;
// Reason/change is the one column with room to give (its text is already
// capped at 70 chars with a Read more toggle), so it's the one kept
// narrower, leaving every other column its real content width.
const AUDIT_COLS = [["When", 150], ["Who", 170], ["Role", 170], ["Action", 240], ["Record", 240], ["Reason / change", 220], ["", 110]];
const auditHead = `<thead><tr>${AUDIT_COLS.map(([label, px]) => `<th class="ep-th" style="width:${px}px">${label}</th>`).join("")}</tr></thead>`;

// ---- Audit log (System Admin, read-only): every recorded action with who,
// what, when and why. Filterable, paginated, exportable to CSV. ----
const root = () => document.getElementById("audit-root");
const resultEl = () => document.getElementById("audit-result");

const EMPTY = { entity_type: "", action: "", actor_type: "", date_from: "", date_to: "", search: "" };
const RECORD_TYPE = { auth: "Sign-in" };
const REASON_PREVIEW = 70;
const expandedReasons = new Set();
let filters = { ...EMPTY };
let page = 1;
let data = { items: [], total: 0, page_size: 50 };
let options = { entity_types: [], actions: [] };

const query = (extra = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v !== "" && v != null) p.set(k, v);
  return p.toString();
};

function reasonCell(row) {
  const text = summary(row);
  if (text.length <= REASON_PREVIEW) return esc(text);
  const open = expandedReasons.has(row.id);
  const shown = open ? text : `${text.slice(0, REASON_PREVIEW)}…`;
  return `${esc(shown)} <button class="ep-link" data-reason="${row.id}">${open ? "Show less" : "Read more"}</button>`;
}

function summary(row) {
  if (row.reason) return row.reason;
  const a = row.after_state;
  if (a && a.status) return `→ ${String(a.status).replace(/_/g, " ")}`;
  if (a && a.state) return `→ ${a.state}`;
  return "";
}

function render() {
  const select = (name, label, values, current) =>
    `<select class="input" data-f="${name}"><option value="">${label}</option>${values
      .map(([v, l]) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(l)}</option>`)
      .join("")}</select>`;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const rows = data.items.length
    ? data.items
        .map(
          (r) => `<tr>
            <td class="ep-cell fs-12px nowrap">${esc(fmtDateTime(r.occurred_at))}</td>
            <td class="ep-cell fw-600">${esc(r.actor_type === "system" ? "System" : r.actor_name || "—")}</td>
            <td class="ep-cell">${esc(roleLabel(r.actor_role || r.actor_type))}</td>
            <td class="ep-cell">${esc(actionLabel(r.action))}${r.imported ? ` ${tag("imported")}` : ""}</td>
            <td class="ep-cell fw-600">${esc(r.entity_label || `${r.entity_type} #${r.entity_id ?? ""}`)}</td>
            <td class="ep-cell ep-sub maxw-280px">${reasonCell(r)}</td>
            <td class="ep-cell text-right"><button class="ep-b" data-detail="${r.id}">Details</button></td>
          </tr>`
        )
        .join("")
    : emptyRow(7, "No entries match these filters.");
  root().innerHTML = `<div class="ep-pane">
    <div class="ep-pane-head"><span>Audit Log</span><span class="ep-k">${data.total} entries · read-only</span></div>
    <div class="ep-pane-pad border-bottom-1px-solid-ink-18 filter-grid">
        <div class="ep-field filter-wide"><div class="ep-k">Search</div><input class="input" data-f="search" placeholder="Name, record or reason" value="${esc(filters.search)}"></div>
        <div class="ep-field"><div class="ep-k">Record type</div>${select("entity_type", "All", options.entity_types.map((v) => [v, RECORD_TYPE[v] || v]), filters.entity_type)}</div>
        <div class="ep-field"><div class="ep-k">Action</div>${select("action", "All", options.actions.map((v) => [v, actionLabel(v)]), filters.action)}</div>
        <div class="ep-field"><div class="ep-k">Who</div>${select("actor_type", "Anyone", [["staff", "Staff"], ["vendor", "Vendors"], ["system", "System"], ["anonymous", "Not signed in"]], filters.actor_type)}</div>
        <div class="ep-field"><div class="ep-k">From</div><input class="input" type="date" data-f="date_from" value="${esc(filters.date_from)}"></div>
        <div class="ep-field"><div class="ep-k">To</div><input class="input" type="date" data-f="date_to" value="${esc(filters.date_to)}"></div>
        <div class="filter-actions">
          <button class="ep-b" data-v="p" id="audit-apply">Apply</button>
          <button class="ep-b" id="audit-reset">Reset</button>
          <button class="ep-b" id="audit-export">Export CSV</button>
        </div>
    </div>
    <div class="overflow-auto"><table class="ep-table audit-table">${auditHead}<tbody>${rows}</tbody></table></div>
    <div class="padding-10px-14px d-flex gap-10px items-center justify-end">
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
  r.querySelectorAll("[data-reason]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = Number(b.dataset.reason);
      if (expandedReasons.has(id)) expandedReasons.delete(id);
      else expandedReasons.add(id);
      render();
    })
  );
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
