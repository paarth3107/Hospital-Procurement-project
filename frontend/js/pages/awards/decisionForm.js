import { esc, kicker, tag } from "../../kit.js";
import { allocationsHtml } from "./awardHelpers.js";

// The Approving Authority's decision on one line (spec 10.2): approve the
// Officer's recommendation (a split can be adjusted), award the system's L1/C1
// instead when the Officer chose someone else, or reject with comments (the line
// returns to the Officer as the next round).
export function decisionFormHtml(line) {
  const c = line.current;
  const canSystem = c.is_override && c.system_top_vendor;
  const split = c.kind === "award" && c.proposed.length > 1;
  const opt = (v, label, checked) => `<label class="ep-check items-start mt-8px"><input type="radio" name="dec-${line.line_item_id}" value="${v}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  return `<div data-dec="${line.line_item_id}" class="mt-12px padding-12px-14px border-1px-solid-ink-30">
    ${kicker(`Decision · needs tier ${c.required_tier}`)}
    <div class="mt-8px fs-13px"><b>Officer recommends${c.kind === "exclude" ? " leaving this line out of the award" : ""}:</b><div class="mt-3px">${c.kind === "exclude" ? "" : allocationsHtml(c.proposed)}</div>
      ${c.is_override ? `<div class="mt-6px">${tag("Not the system's top-ranked bid", "att")} System's L1/C1 is <b>${esc(c.system_top_vendor || "")}</b>.</div>` : ""}
      ${c.officer_reason ? `<div class="mt-6px pre-wrap"><span class="ep-sub">Officer's reason:</span> ${esc(c.officer_reason)}</div>` : ""}</div>
    ${opt("approve", c.kind === "exclude" ? "Approve leaving the line out" : "Approve the Officer's recommendation", true)}
    ${
      split
        ? `<div class="margin-6px-0-0-26px fs-13px">${c.proposed
            .map((a) => `<div class="d-flex gap-10px items-center mt-4px"><span class="minw-230px">${esc(a.vendor_name)}</span><input class="input w-90px" type="number" min="0" max="100" step="1" name="adj-${a.bid_id}" value="${a.share_pct}"> <span class="ep-sub">%</span></div>`)
            .join("")}<div class="ep-sub mt-4px">You can adjust the shares; they must total 100% (each at least ${line.min_split_pct}%).</div></div>`
        : ""
    }
    ${canSystem ? opt("award_system_l1", `Award to the system's L1/C1 instead — <b>${esc(c.system_top_vendor)}</b>`, false) : ""}
    ${opt("reject", "Reject — return to the Officer", false)}
    <div class="ep-field mt-10px">${kicker("Comments (if any)")}<textarea class="input w-full" name="comments" rows="2"></textarea>
      <div class="hint text-danger-700 mt-4px" data-comments-msg hidden>A reason is mandatory to reject.</div></div>
    <div id="dec-result-${line.line_item_id}" class="result"></div>
    <div class="d-flex justify-end mt-8px"><button class="ep-b" data-v="p" data-save-dec="${line.line_item_id}">Confirm decision</button></div>
  </div>`;
}

export function readDecision(panel, line) {
  const decision = panel.querySelector(`input[name="dec-${line.line_item_id}"]:checked`)?.value || "approve";
  const box = panel.querySelector('[name="comments"]');
  const comments = box.value.trim();
  if (decision === "reject" && !comments) {
    box.classList.add("invalid");
    panel.querySelector("[data-comments-msg]").hidden = false;
    box.focus();
    return null;
  }
  const body = { decision, comments: comments || null };
  if (decision === "approve" && line.current.proposed.length > 1) {
    body.allocations = line.current.proposed.map((a) => ({ bid_id: a.bid_id, share_pct: Number(panel.querySelector(`[name="adj-${a.bid_id}"]`).value || 0) })).filter((a) => a.share_pct > 0);
  }
  return body;
}

export function wireDecision(panel) {
  panel.querySelector('[name="comments"]').addEventListener("input", (e) => {
    e.target.classList.remove("invalid");
    panel.querySelector("[data-comments-msg]").hidden = true;
  });
}
