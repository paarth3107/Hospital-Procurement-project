import { useState } from "react";
import { Tag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import { setPendingListFilter, switchView } from "../../lib/bridge";
import { OVERRIDE_TYPE_LABELS, ROLE_TABS } from "../../lib/constants";
import type { DashboardStats, StaffRole } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/dashboard/actionQueue.js -- "My action
// queue": one row per thing that actually needs a human, limited to screens
// this role can open (ROLE_TABS gates visibility the same way the sidebar
// itself does -- a task whose target tab this role's sidebar wouldn't even
// show is skipped, not just hidden some other way). Shared across every
// role's dashboard.
const PAGE_SIZE = 6;

interface ActionTask {
  view: string;
  task: string;
  detail: string;
  ref: string;
  due: "today" | "open";
  hot?: boolean;
  urgent?: boolean;
  vendorId?: number;
  allStatuses?: boolean;
  tenderId?: number;
}

function buildTasks(s: DashboardStats, role: StaffRole | undefined): ActionTask[] {
  const allowed = new Set(ROLE_TABS[role || ""] || []);
  const tasks: ActionTask[] = [];
  const add = (view: string, task: Omit<ActionTask, "view">) => {
    if (allowed.has(view)) tasks.push({ view, ...task });
  };
  // "queue" (Vendor List's permission) gates whether this role sees these at
  // all; openTask() below then jumps straight to that vendor's profile
  // (Vendor View) instead of landing on the list.
  for (const v of s.pending_vendors)
    add("queue", {
      // Real bug, found 2026-10-22: an Expedited Registration Review flag
      // (spec §6.7/§12.3) already sorted this vendor to the top of the
      // Vendor List and GET /dashboard/stats's own query, but nothing here
      // said so or sorted it first in THIS list -- the one screen most
      // people actually work from.
      task: `${v.expedited_review_tender_id != null ? "URGENT -- " : ""}${v.responded ? "Review vendor reply" : "Verify KYC"} — ${v.legal_name}`,
      detail:
        v.expedited_review_tender_id != null
          ? `Flagged urgent for tender #${v.expedited_review_tender_id}`
          : v.responded
            ? "Vendor answered your information request"
            : "New registration, documents awaiting review",
      ref: `Vendor #${v.id}`,
      due: "today",
      hot: true,
      urgent: v.expedited_review_tender_id != null,
      vendorId: v.id,
    });
  for (const v of s.docs_to_verify)
    add("queue", {
      task: `Verify documents — ${v.legal_name}`,
      detail: `${v.count} document(s) uploaded by an approved vendor`,
      ref: `Vendor #${v.vendor_id}`,
      due: "today",
      hot: true,
      vendorId: v.vendor_id,
      allStatuses: true,
    });
  for (const a of s.award_tasks)
    add("awards", {
      task: a.kind === "decide" ? `L1 approval — ${a.title}` : `Recommend award — ${a.title}`,
      detail: a.detail + (a.tier ? ` · tier ${a.tier}` : ""),
      ref: `#${a.tender_id}`,
      due: "today",
      hot: true,
    });
  for (const t of s.pending_approval) add("approvals", { task: `Approve tender — ${t.title}`, detail: `Round ${t.round_number} · required tier ${t.required_tier}`, ref: `#${t.id}`, due: "today", hot: true });
  for (const m of s.pending_mappings)
    add("mappings-requests", { task: `Category mapping — ${m.vendor_name}`, detail: `Requesting: ${m.target_name} (${m.target_kind})`, ref: `Vendor #${m.vendor_id}`, due: "open" });
  for (const e of s.eval_workload)
    add("evaluation", { task: `Evaluate — ${e.product_name}`, detail: `${e.tender_title} · ${e.submitted_count} bid(s) submitted, bidding closed`, ref: `#${e.tender_id}`, due: "open", hot: true });
  for (const r of s.stale_ratings)
    add("ratings", { task: `Refresh rating — ${r.vendor_name}`, detail: `${r.procurement_type} · last updated ${r.days_since_update} days ago`, ref: `Vendor #${r.vendor_id}`, due: "open" });
  for (const h of s.held_lines)
    add("tenders", { task: `Line held back — ${h.product_name}`, detail: `${h.tender_title} · no eligible vendor`, ref: `#${h.tender_id}`, due: "open", hot: true, tenderId: h.tender_id });
  for (const t of s.draft_tenders)
    add("tenders", { task: `Complete and submit — ${t.title}`, detail: t.line_count ? `${t.line_count} line item(s) — not yet submitted for approval` : "No line items yet", ref: `#${t.id}`, due: "open", hot: true, tenderId: t.id });
  // Spec §12 -- any override escalated to (or routed straight to) this
  // role/tier, across every type (app/services/overrides.py's can_decide).
  // Decided on the new Decisions tab, not here -- this row just gets you
  // there.
  for (const d of s.pending_decisions)
    add("decisions", { task: `Decide — ${OVERRIDE_TYPE_LABELS[d.override_type] ?? d.override_type}`, detail: `${d.entity_label ?? ""} · ${d.justification}`, ref: `#${d.id}`, due: "today", hot: true });
  // Array.prototype.sort is a stable sort (ES2019+) -- this only promotes
  // `urgent` tasks ahead of everything else, without reshuffling the
  // relative order of anything else built above.
  return tasks.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
}

// "Due" as a pill, same convention every status/state column in the app
// already uses, instead of a lone coloured word: red for an actual deadline
// (today), amber for flagged-urgent-but-open-ended, plain for routine.
function DueTag({ t }: { t: ActionTask }) {
  return t.due === "today" ? <Tag text="Due today" tone="neg" /> : <Tag text="Open" tone={t.hot ? "att" : ""} />;
}

function openTask(t: ActionTask) {
  // Real bug, found 2026-10-22: this used to set the vendor/tender id via
  // the (now-removed) transient bridge state and then switchView(t.view)
  // regardless -- for a vendor task t.view is "queue" (the LIST, Vendor
  // List's own permission gate), so Open always landed on the list, never
  // the specific vendor; the id it had just stashed was never read by
  // anything, since VendorListPage never looked at it. Now both cases
  // navigate straight to the detail route with the id in the URL itself.
  if (t.vendorId) {
    setPendingListFilter(t.allStatuses ? "" : "pending_verification");
    switchView(`vendor-view/${t.vendorId}`);
    return;
  }
  if (t.tenderId != null) {
    switchView(`tender-edit/${t.tenderId}`);
    return;
  }
  switchView(t.view);
}

export function ActionQueuePanel({ s, role }: { s: DashboardStats; role: StaffRole | undefined }) {
  const [page, setPage] = useState(0);
  const tasks = buildTasks(s, role);
  const { pageItems, totalPages, page: clamped } = pageSlice(tasks, page, PAGE_SIZE);
  if (clamped !== page) setPage(clamped);
  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>My Action Queue</span>
        <span className="ep-k">{tasks.length} open</span>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Task", "Ref", "Due", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={4}>
                Nothing needs your attention right now.
              </td>
            </tr>
          ) : (
            pageItems.map((t, i) => (
              <tr key={i}>
                <td className="ep-cell">
                  <div className="fw-600">{t.task}</div>
                  <div className="ep-sub">{t.detail}</div>
                </td>
                <td className="ep-cell fs-12px">{t.ref}</td>
                <td className="ep-cell">
                  <DueTag t={t} />
                </td>
                <td className="ep-cell text-right">
                  <button type="button" className="ep-b" onClick={() => openTask(t)}>
                    Open
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Pagination page={clamped} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
