import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { switchView, ROLE_TABS } from "../nav.js";
import { preselectVendor } from "./vendorQueuePage.js";
import { esc, kicker, th, emptyRow, fmtDate, fmtDateTime } from "../kit.js";

// ---- Staff dashboard: the prototype's command-centre layout, fed by
// GET /dashboard/stats (real counts only). ----

function kpiStrip(s) {
  const v = s.vendors_by_status;
  const cells = [
    ["Live tenders", s.open_tenders_count, s.next_bid_close ? `next bid close ${fmtDate(s.next_bid_close)}` : "none open for bidding"],
    ["Active vendors", v.active || 0, `${v.suspended || 0} suspended · ${(v.pending_verification || 0) + (v.info_requested || 0)} pending`],
    ["Bids submitted", s.bids_submitted_count, "prices masked from staff"],
    ["Awaiting your approval", s.pending_approval_count, "e-tender approval"],
  ];
  return `<div class="ep-kpis">${cells
    .map(([label, value, sub]) => `<div class="ep-kpi">${kicker(label)}<div class="ep-kpi-value">${esc(value)}</div><div class="ep-sub">${esc(sub)}</div></div>`)
    .join("")}</div>`;
}

function pipeline(s) {
  const v = s.vendors_by_status;
  const stages = [
    ["Vendor registration", `${v.active || 0} active · ${(v.pending_verification || 0) + (v.info_requested || 0)} in queue`, (v.active || 0) > 0],
    ["Master & mapping", `${s.catalog_entries_count} entries · ${s.mappings_approved_count} mappings`, s.catalog_entries_count > 0 && s.mappings_approved_count > 0],
    ["Rating refresh", s.last_rating_update ? `last manual update ${fmtDate(s.last_rating_update)}` : "no manual entries yet", !!s.last_rating_update],
    ["Tender & publishing", `${s.lines_published} of ${s.lines_total} live lines published`, s.lines_total > 0 && s.lines_published === s.lines_total],
    ["Bid → L1 → PO", `${s.bids_submitted_count} bid(s) received`, s.bids_submitted_count > 0],
  ];
  return `<div>
    <div class="ep-k" style="margin-bottom:9px">Procurement pipeline</div>
    <div class="ep-pipeline">${stages
      .map(
        ([name, note, done], i) => `<div class="ep-stage">
          <div style="display:flex;align-items:center;gap:7px">
            <span class="ep-stage-dot" style="background:${done ? "#ec3013" : "rgba(32,30,29,.18)"};color:${done ? "#f3f2f2" : "#201e1d"}">${i + 1}</span>
            <span style="font-size:12.5px;font-weight:800">${esc(name)}</span>
          </div>
          <div class="ep-sub" style="line-height:1.4">${esc(note)}</div>
          <div style="height:3px;margin-top:auto;background:${done ? "#ec3013" : "rgba(32,30,29,.18)"}"></div>
        </div>`
      )
      .join("")}</div>
  </div>`;
}

// One task per thing that actually needs a human, limited to screens this role can open.
function buildTasks(s) {
  const allowed = new Set(ROLE_TABS[state.user?.role] || []);
  const tasks = [];
  const add = (view, task) => allowed.has(view) && tasks.push({ view, ...task });
  for (const v of s.pending_vendors)
    add("queue", { task: `${v.responded ? "Review vendor reply" : "Verify KYC"} — ${v.legal_name}`, detail: v.responded ? "Vendor answered your information request" : "New registration, documents awaiting review", ref: `Vendor #${v.id}`, due: "today", hot: true, vendorId: v.id });
  for (const v of s.docs_to_verify)
    add("queue", { task: `Verify documents — ${v.legal_name}`, detail: `${v.count} document(s) uploaded by an approved vendor`, ref: `Vendor #${v.vendor_id}`, due: "today", hot: true, vendorId: v.vendor_id, allStatuses: true });
  for (const a of s.award_tasks)
    add("awards", { task: a.kind === "decide" ? `L1 approval — ${a.title}` : `Recommend award — ${a.title}`, detail: a.detail + (a.tier ? ` · tier ${a.tier}` : ""), ref: `#${a.tender_id}`, due: "today", hot: true });
  for (const f of s.po_files_pending) add("pofiles", { task: `Upload PO data file — ${f.vendor_name}`, detail: "Generated for the ERP; download, import, then record the result", ref: f.batch_id, due: "open" });
  for (const t of s.pending_approval) add("approvals", { task: `Approve tender — ${t.title}`, detail: `Round ${t.round_number} · required tier ${t.required_tier}`, ref: `#${t.id}`, due: "today", hot: true });
  if (s.mappings_pending_count) add("mappings", { task: `Review ${s.mappings_pending_count} mapping request(s)`, detail: "Vendor category / item requests", ref: "Mapping", due: "open" });
  for (const h of s.held_lines) add("tenders", { task: `Line held back — ${h.product_name}`, detail: `${h.tender_title} · no eligible vendor`, ref: `#${h.tender_id}`, due: "open", hot: true });
  for (const t of s.open_tenders) add("tenders", { task: `Track bids — ${t.title}`, detail: `${t.bids_received} bid(s) received`, ref: `#${t.id}`, due: t.bid_due_date ? fmtDate(t.bid_due_date) : "—" });
  return tasks;
}

function actionQueue(s) {
  const tasks = buildTasks(s);
  const rows = tasks.length
    ? tasks
        .map(
          (t, i) => `<tr>
            <td class="ep-cell"><div style="font-weight:600">${esc(t.task)}</div><div class="ep-sub">${esc(t.detail)}</div></td>
            <td class="ep-cell" style="font-size:12px">${esc(t.ref)}</td>
            <td class="ep-cell" style="font-size:12px;color:${t.hot ? "#ae1800" : "rgba(32,30,29,.7)"}">${esc(t.due)}</td>
            <td class="ep-cell" style="text-align:right"><button class="ep-b" data-task="${i}">Open</button></td>
          </tr>`
        )
        .join("")
    : emptyRow(4, "Nothing needs your attention right now.");
  return {
    html: `<div class="ep-pane">
      <div class="ep-pane-head"><span>My action queue</span><span class="ep-k">${tasks.length} open</span></div>
      <table class="ep-table">${th("Task", "Ref", "Due", "")}<tbody>${rows}</tbody></table>
    </div>`,
    tasks,
  };
}

function vendorBase(s) {
  const v = s.vendors_by_status;
  const total = Object.values(v).reduce((a, b) => a + b, 0) || 1;
  const rows = [
    ["Active", v.active || 0, "#2f8f4e"],
    ["Pending verification", v.pending_verification || 0, "#ff9783"],
    ["Info requested", v.info_requested || 0, "#7d7979"],
    ["Suspended", v.suspended || 0, "#201e1d"],
    ["Rejected", v.rejected || 0, "rgba(32,30,29,.45)"],
    ["Blacklisted", v.blacklisted || 0, "#201e1d"],
  ];
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Vendor base</span></div>
    <div style="padding:14px">
      ${rows
        .map(
          ([label, n, color]) => `<div style="margin-bottom:13px">
            <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600"><span>${label}</span><span>${n}</span></div>
            <div class="ep-bar" style="margin-top:5px"><div style="width:${(n / total) * 100}%;background:${color}"></div></div>
          </div>`
        )
        .join("")}
    </div>
  </div>`;
}

function openTask(task) {
  if (task.vendorId) preselectVendor(task.vendorId, task.allStatuses ? "" : "pending_verification");
  switchView(task.view);
}

export async function loadDashboard() {
  const root = document.getElementById("dashboard-root");
  const resultEl = document.getElementById("dashboard-result");
  try {
    const s = await api("/dashboard/stats");
    const queue = actionQueue(s);
    root.innerHTML = `<div style="display:flex;flex-direction:column;gap:22px">
      ${kpiStrip(s)}
      ${pipeline(s)}
      <div class="ep-grid" style="grid-template-columns:1.45fr 1fr">${queue.html}${vendorBase(s)}</div>
    </div>`;
    root.querySelectorAll("button[data-task]").forEach((b) => b.addEventListener("click", () => openTask(queue.tasks[Number(b.dataset.task)])));
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}
