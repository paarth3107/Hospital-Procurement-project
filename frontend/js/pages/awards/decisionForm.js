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
  const opt = (v, label, checked) => `<label class="ep-check" style="align-items:flex-start;margin-top:8px"><input type="radio" name="dec-${line.line_item_id}" value="${v}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
  return `<div data-dec="${line.line_item_id}" style="margin-top:12px;padding:12px 14px;border:1px solid rgba(32,30,29,.3)">
    ${kicker(`Decision · needs tier ${c.required_tier}`)}
    <div style="margin-top:8px;font-size:13px"><b>Officer recommends${c.kind === "exclude" ? " leaving this line out of the award" : ""}:</b><div style="margin-top:3px">${c.kind === "exclude" ? "" : allocationsHtml(c.proposed)}</div>
      ${c.is_override ? `<div style="margin-top:6px">${tag("Not the system's top-ranked bid", "att")} System's L1/C1 is <b>${esc(c.system_top_vendor || "")}</b>.</div>` : ""}
      ${c.officer_reason ? `<div style="margin-top:6px;white-space:pre-wrap"><span class="ep-sub">Officer's reason:</span> ${esc(c.officer_reason)}</div>` : ""}</div>
    ${opt("approve", c.kind === "exclude" ? "Approve leaving the line out" : "Approve the Officer's recommendation", true)}
    ${
      split
        ? `<div style="margin:6px 0 0 26px;font-size:13px">${c.proposed
            .map((a) => `<div style="display:flex;gap:10px;align-items:center;margin-top:4px"><span style="min-width:230px">${esc(a.vendor_name)}</span><input class="input" style="width:90px" type="number" min="0" max="100" step="1" name="adj-${a.bid_id}" value="${a.share_pct}"> <span class="ep-sub">%</span></div>`)
            .join("")}<div class="ep-sub" style="margin-top:4px">You can adjust the shares; they must total 100% (each at least ${line.min_split_pct}%).</div></div>`
        : ""
    }
    ${canSystem ? opt("award_system_l1", `Award to the system's L1/C1 instead — <b>${esc(c.system_top_vendor)}</b>`, false) : ""}
    ${opt("reject", "Reject — return to the Officer", false)}
    <div class="ep-field" style="margin-top:10px">${kicker("Comments (if any)")}<textarea class="input" name="comments" rows="2" style="width:100%"></textarea>
      <div class="hint" data-comments-msg style="color:#ae1800;margin-top:4px" hidden>A reason is mandatory to reject.</div></div>
    <div id="dec-result-${line.line_item_id}" class="result"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="ep-b" data-v="p" data-save-dec="${line.line_item_id}">Confirm decision</button></div>
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
