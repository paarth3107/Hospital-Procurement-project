import { state } from "../../state.js";
import { switchView, ROLE_TABS } from "../../nav.js";
import { preselectVendor } from "../vendorQueuePage.js";
import { openTenderById } from "../tenders/tendersPage.js";
import { esc, th, emptyRow } from "../../kit.js";

// ---- "My action queue": one row per thing that actually needs a human,
// limited to screens this role can open. Shared across every role's
// dashboard (the task list itself is already role-aware; only the
// surrounding layout differs per role). ----

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
  for (const t of s.pending_approval) add("approvals", { task: `Approve tender — ${t.title}`, detail: `Round ${t.round_number} · required tier ${t.required_tier}`, ref: `#${t.id}`, due: "today", hot: true });
  for (const m of s.pending_mappings)
    add("mappings", { task: `Category mapping — ${m.vendor_name}`, detail: `Requesting: ${m.target_name} (${m.target_kind})`, ref: `Vendor #${m.vendor_id}`, due: "open" });
  for (const e of s.eval_workload)
    add("evaluation", { task: `Evaluate — ${e.product_name}`, detail: `${e.tender_title} · ${e.submitted_count} bid(s) submitted, bidding closed`, ref: `#${e.tender_id}`, due: "open", hot: true });
  for (const r of s.stale_ratings)
    add("ratings", { task: `Refresh rating — ${r.vendor_name}`, detail: `${r.procurement_type} · last updated ${r.days_since_update} days ago`, ref: `Vendor #${r.vendor_id}`, due: "open" });
  for (const h of s.held_lines) add("tenders", { task: `Line held back — ${h.product_name}`, detail: `${h.tender_title} · no eligible vendor`, ref: `#${h.tender_id}`, due: "open", hot: true });
  for (const t of s.draft_tenders)
    add("tenders", { task: `Complete and submit — ${t.title}`, detail: t.line_count ? `${t.line_count} line item(s) — not yet submitted for approval` : "No line items yet", ref: `#${t.id}`, due: "open", hot: true, tenderId: t.id });
  return tasks;
}

export function actionQueue(s) {
  const tasks = buildTasks(s);
  const rows = tasks.length
    ? tasks
        .map(
          (t, i) => `<tr>
            <td class="ep-cell"><div class="fw-600">${esc(t.task)}</div><div class="ep-sub">${esc(t.detail)}</div></td>
            <td class="ep-cell fs-12px">${esc(t.ref)}</td>
            <td class="ep-cell fs-12px ${t.hot ? "text-danger-700" : "text-ink-70"}">${esc(t.due)}</td>
            <td class="ep-cell text-right"><button class="ep-b" data-task="${i}">Open</button></td>
          </tr>`
        )
        .join("")
    : emptyRow(4, "Nothing needs your attention right now.");
  return {
    html: `<div class="ep-pane">
      <div class="ep-pane-head"><span>My Action Queue</span><span class="ep-k">${tasks.length} open</span></div>
      <table class="ep-table">${th("Task", "Ref", "Due", "")}<tbody>${rows}</tbody></table>
    </div>`,
    tasks,
  };
}

function openTask(task) {
  if (task.vendorId) preselectVendor(task.vendorId, task.allStatuses ? "" : "pending_verification");
  switchView(task.view);
  if (task.tenderId) openTenderById(task.tenderId);
}

// Wires the "Open" buttons of an actionQueue() result already inserted into `root`.
export function wireActionQueue(root, queue) {
  root.querySelectorAll("button[data-task]").forEach((b) => b.addEventListener("click", () => openTask(queue.tasks[Number(b.dataset.task)])));
}
