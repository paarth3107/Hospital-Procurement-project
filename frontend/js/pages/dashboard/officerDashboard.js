import { esc, kicker, th, emptyRow, fmtDate, tag, stateTag } from "../../kit.js";
import { switchView } from "../../nav.js";
import { kpiStrip as kpiTiles } from "./kpi.js";
import { bars } from "../../charts.js";
import { openTenderById } from "../tenders/tendersPage.js";
import { actionQueue, wireActionQueue } from "./actionQueue.js";

// ---- Procurement Officer's own dashboard (product decision, 2026-09-29 --
// the spec has no dashboard requirements). A tender-lifecycle pipeline built
// only from stages this role drives or is directly waiting on:
//   Draft -> Pending E-Tender Approval -> Published (bidding open)
//   -> Ready to recommend -> Awaiting L1 approval
// Deliberately excludes Category Manager's stages (vendor registration,
// mapping, rating refresh) and "technical evaluation in progress" -- the
// Officer has nothing to do while that's running; a line simply appears in
// "Ready to recommend" once it closes. "Awaiting L1 approval" stays as a
// tracking-only stage (not phrased as an action): there is nothing further
// for the Officer to do once a recommendation is approved -- the tender
// finalizes on its own. It's kept visible only so the Officer knows what's
// still out for a decision, and it folds back into "Ready to recommend" if
// the Approving Authority sends it back instead. ----

// Each card jumps to where that work actually happens: Draft -> Tenders (to
// keep editing/submit it), Pending approval / Live -> Bid evaluation (where
// their progress is tracked), Ready to recommend -> L1 award.
function kpiStrip(o) {
  return kpiTiles([
    ["Draft tenders", o.draft_count, "not yet submitted for approval", "tenders", "file-text", "primary"],
    ["Pending approval", o.pending_approval_count, "sent, waiting on the Approving Authority", "evaluation", "clock", "warning"],
    ["Live tenders", o.live_count, o.awaiting_evaluation_close_count ? `bidding open · ${o.awaiting_evaluation_close_count} more closed, awaiting evaluation` : "bidding open", "evaluation", "activity", "success"],
    ["Ready to recommend", o.ready_to_recommend_lines, `${o.ready_to_recommend_count} tender(s)`, "awards", "award", "info"],
  ]);
}

function pipeline(o) {
  const stages = [
    ["Draft", `${o.draft_count} tender(s)`, o.draft_count],
    ["Pending E-Tender Approval", `${o.pending_approval_count} tender(s)`, o.pending_approval_count],
    [
      "Published — bidding open",
      o.awaiting_evaluation_close_count ? `${o.live_count} tender(s) · ${o.awaiting_evaluation_close_count} more closed, awaiting evaluation (Category Manager)` : `${o.live_count} tender(s)`,
      o.live_count,
    ],
    ["Ready to recommend", `${o.ready_to_recommend_lines} line(s) · ${o.ready_to_recommend_count} tender(s)`, o.ready_to_recommend_lines],
    ["Awaiting L1 approval", `${o.awaiting_decision_lines} line(s) · ${o.awaiting_decision_count} tender(s)`, o.awaiting_decision_lines],
  ];
  return `<div>
    <div class="ep-k mb-9px">My tender pipeline</div>
    <div class="ep-pipeline">${stages
      .map(
        ([name, note, count], i) => `<div class="ep-stage">
          <div class="d-flex items-center gap-7px">
            <span class="ep-stage-dot ${count ? "ep-stage-dot-on" : "ep-stage-dot-off"}">${i + 1}</span>
            <span class="fs-12-5px fw-800">${esc(name)}</span>
          </div>
          <div class="ep-sub lh-1-4">${esc(note)}</div>
          <div class="ep-stage-bar ${count ? "ep-stage-bar-on" : "ep-stage-bar-off"}"></div>
        </div>`
      )
      .join("")}</div>
  </div>`;
}

// Replaces the old generic "Bids submitted" number (a single count with no
// tender attached, per feedback 2026-09-29) with one row per tender actually
// in progress, each carrying its own bid count.
function tendersTable(o) {
  const rows = o.tenders.length
    ? o.tenders
        .map((t) => {
          const nextStep =
            [t.lines_ready_to_recommend ? tag(`${t.lines_ready_to_recommend} to recommend`, "att") : "", t.lines_awaiting_decision ? tag(`${t.lines_awaiting_decision} awaiting approval`) : ""]
              .filter(Boolean)
              .join(" ") || '<span class="ep-sub">—</span>';
          const due = t.bid_due_date ? new Date(t.bid_due_date) : null;
          const closed = due && due <= new Date();
          const bidding =
            t.status === "published"
              ? `${t.bids_received} bid(s)${due ? ` · ${closed ? "closed" : "closes"} ${fmtDate(t.bid_due_date)}` : ""}${closed && !t.lines_ready_to_recommend && !t.lines_awaiting_decision ? '<div class="ep-sub">awaiting technical evaluation close</div>' : ""}`
              : '<span class="ep-sub">—</span>';
          return `<tr>
            <td class="ep-cell fw-600">${esc(t.title)}</td>
            <td class="ep-cell">${stateTag(t.status)}</td>
            <td class="ep-cell fs-12-5px">${bidding}</td>
            <td class="ep-cell fs-12-5px">${nextStep}</td>
            <td class="ep-cell text-right"><button class="ep-b" data-open="${t.id}">Open</button></td>
          </tr>`;
        })
        .join("")
    : emptyRow(5, "Nothing in Draft, Pending Approval, or Published right now.");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Tenders</span><span class="ep-k">${o.tenders.length} in progress</span></div>
    <table class="ep-table">${th("Title", "Status", "Bidding", "Next step", "")}<tbody>${rows}</tbody></table>
  </div>`;
}

export function renderOfficerDashboard(root, s) {
  const o = s.officer;
  const queue = actionQueue(s);
  root.innerHTML = `<div class="d-flex flex-col gap-22px">
    ${kpiStrip(o)}
    ${pipeline(o)}
    <div class="ep-pane"><div class="ep-pane-head"><span>Pipeline by stage</span><span class="ep-k">tenders and lines, now</span></div><div class="ep-pane-pad"><div id="officer-stage-chart"></div></div></div>
    <div class="ep-grid grid-cols-1-45fr-1fr">${queue.html}${tendersTable(o)}</div>
  </div>`;
  wireActionQueue(root, queue);
  drawStageChart(o);
  root.querySelectorAll(".ep-kpi[data-view]").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  root.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      switchView("tenders");
      openTenderById(b.dataset.open);
    })
  );
}

function drawStageChart(o) {
  const el = document.getElementById("officer-stage-chart");
  if (!el) return;
  bars(el, {
    categories: ["Draft tenders", "Pending approval", "Live tenders", "Lines ready to recommend", "Lines awaiting L1"],
    series: [{ name: "Count", data: [o.draft_count, o.pending_approval_count, o.live_count, o.ready_to_recommend_lines, o.awaiting_decision_lines] }],
    pickColors: (p) => [p.muted, p.warning, p.primary, p.success, p.info],
    height: 240,
  });
}
