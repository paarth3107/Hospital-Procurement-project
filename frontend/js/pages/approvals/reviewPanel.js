import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, kicker, tag, th, emptyRow, fmtDateTime, inr } from "../../kit.js";

// The approver's review of one tender, before publishing it (spec 7.2): header
// terms, line items by procurement type, the vendors each line would go to,
// warnings, the approval history, and the decision. Everything comes from
// GET /tenders/{id}/approval-review.
const pane = (title, right, body) => `<div class="ep-pane"><div class="ep-pane-head"><span>${title}</span>${right || ""}</div><div style="padding:14px 16px">${body}</div></div>`;
const fact = (k, v, span = 1) => `<div style="grid-column:span ${span}">${kicker(k)}<div style="font-weight:600;margin-top:3px;font-size:13px;word-break:break-word">${v == null || v === "" ? "—" : v}</div></div>`;
const facts = (items) => `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px 18px">${items.join("")}</div>`;
const kv = (o) =>
  Object.entries(o || {})
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `<div class="ep-sub">${esc(k.replace(/_/g, " "))}: <b>${esc(Array.isArray(v) ? v.join(", ") : v === true ? "yes" : v === false ? "no" : v)}</b></div>`)
    .join("");

function lineHtml(l) {
  const method = l.technical_eval_method === "qualify_disqualify" ? "Qualify / disqualify, then lowest price (L1)" : l.technical_eval_method === "scored" ? "Scored technical ranking, then lowest price (L1)" : `QCBS — technical ${l.technical_weight ?? "?"} / price ${l.price_weight ?? "?"}`;
  const vendors = l.eligible_vendors.length
    ? `<table class="ep-table" style="margin-top:6px">${th("Vendor", "Rating")}<tbody>${l.eligible_vendors.map((v) => `<tr><td class="ep-cell">${esc(v.legal_name)}</td><td class="ep-cell">${v.rating_score}</td></tr>`).join("")}</tbody></table>`
    : '<div class="ep-note warn" style="margin-top:6px">No eligible vendor: this line would be held back and not published.</div>';
  return `<div style="padding:12px 0;border-top:1px solid rgba(32,30,29,.2)">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-size:16px;font-weight:800">${esc(l.product_name)}</span><span class="ep-sub">${esc(l.product_code)} · ${esc(l.category)}</span>${tag(l.procurement_type, l.procurement_type)}${l.split_award_allowed ? tag("Split award allowed", "esc") : ""}</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 18px;margin-top:10px">
      ${fact("Quantity", `${l.qty}${l.uom ? " " + esc(l.uom) : ""}`)}${fact("Estimated price / unit", l.estimated_price != null ? inr(l.estimated_price) : "not set")}${fact("Line value", l.line_value != null ? inr(l.line_value) : "—")}${fact("Minimum vendor rating", l.min_rating_applied)}
      ${fact("Evaluation", esc(method), 2)}${fact("Regulatory class", esc(l.regulatory_class || ""))}${fact("Required vendor documents", l.required_documents.length ? esc(l.required_documents.join(", ")) : "none")}
    </div>
    ${kv(l.line_details) || kv(l.catalog_attrs) ? `<div style="margin-top:8px">${kicker("Specification & terms")}${kv(l.line_details)}${kv(l.catalog_attrs)}</div>` : ""}
    <div style="margin-top:10px">${kicker(`Vendors this line would be published to (${l.eligible_vendors.length})`)}${vendors}</div></div>`;
}

export async function renderReview(container, tenderId, { onBack, onDecided, resultEl }) {
  let r;
  try {
    r = await api(`/tenders/${tenderId}/approval-review`);
  } catch (err) {
    showResult(resultEl, "Could not load the review: " + err.message, false);
    return;
  }
  const rounds = r.rounds.length
    ? `<table class="ep-table">${th("Round", "Required tier", "Submitted by", "Decision", "Reviewer / comments")}<tbody>${r.rounds
        .map((x) => `<tr><td class="ep-cell">${x.round_number}</td><td class="ep-cell">Tier ${x.required_tier}</td><td class="ep-cell" style="font-size:12.5px">${esc(x.submitted_by || "—")}<div class="ep-sub">${fmtDateTime(x.submitted_at)}</div></td><td class="ep-cell">${tag(x.decision, x.decision === "approved" ? "pos" : x.decision === "rejected" ? "neg" : "att")}</td><td class="ep-cell" style="font-size:12.5px">${x.reviewer ? esc(x.reviewer) : "—"}${x.decided_at ? `<div class="ep-sub">${fmtDateTime(x.decided_at)}</div>` : ""}${x.comments ? `<div>${esc(x.comments)}</div>` : ""}</td></tr>`)
        .join("")}</tbody></table>`
    : '<div class="ep-sub">No rounds yet.</div>';

  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    <div><button class="ep-b" id="rv-back">← Approval inbox</button></div>
    <div class="ep-pane ep-pane-pad" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">${kicker(`Tender #${r.id} · ${r.tender_type.toUpperCase().replace("_", " ")} · round ${r.round_number}`)}<h4 style="margin:4px 0 3px;font-size:22px">${esc(r.title)}</h4><div class="ep-sub">${esc(r.facility_name)}${r.department ? " · " + esc(r.department) : ""}</div></div>
      <div>${kicker("Total estimated value")}<div style="font-size:22px;font-weight:800;margin-top:3px">${inr(r.total_estimated_value)}</div></div>
      <div>${kicker("Approval required from")}<div style="margin-top:5px">${tag(r.required_tier ? "Tier " + r.required_tier : "—", "att")}</div><div class="ep-sub">${esc(r.tier_label || "")}</div></div>
    </div>
    ${r.warnings.map((w) => `<div class="ep-note warn">${esc(w)}</div>`).join("")}
    ${pane("Tender details", "", facts([
      fact("Type", esc(r.tender_type.replace("_", " "))), fact("Facility / entity", esc(r.facility_name) + (r.facility_code ? ` (${esc(r.facility_code)})` : "")), fact("Department", esc(r.department || "")), fact("Prepared by", esc(r.created_by || "")),
      fact("Publish date", r.publish_date ? fmtDateTime(r.publish_date) : "On approval"), fact("Bids close", fmtDateTime(r.bid_due_date)), fact("Default minimum vendor rating", r.min_rating_threshold), fact("Vendors per line (min / max)", `${r.min_invites ?? "—"} / ${r.max_invites ?? "—"}`),
      ...(r.description ? [fact("Description & terms", `<span style="white-space:pre-wrap;font-weight:400">${esc(r.description)}</span>`, 4)] : []),
    ]))}
    ${pane(`Line items (${r.lines.length})`, `<span class="ep-k">${r.lines.filter((l) => l.held_back).length} would be held back</span>`, r.lines.map(lineHtml).join(""))}
    ${pane("Approval history", "", rounds)}
    <div class="ep-pane ep-pane-pad">
      ${
        r.can_decide
          ? `<div class="ep-field">${kicker("Comments (required to reject)")}<textarea class="input" id="rv-comments" rows="3" style="width:100%"></textarea><div id="rv-msg" class="hint" style="margin-top:4px;color:#ae1800" hidden>A reason is mandatory to reject a tender.</div></div>
             <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="ep-b" id="rv-reject">Reject — return to draft</button><button class="ep-b" data-v="p" id="rv-approve">Approve &amp; publish</button></div>`
          : `<div class="hint">${r.status === "pending_approval" ? `You can't decide this tender: it needs an Approving Authority at tier ${r.required_tier} or above.` : `This tender is ${esc(r.status.replace("_", " "))}; no decision is pending.`}</div>`
      }
    </div></div>`;

  container.querySelector("#rv-back").addEventListener("click", onBack);
  const box = container.querySelector("#rv-comments");
  box?.addEventListener("input", () => {
    box.classList.remove("invalid");
    container.querySelector("#rv-msg").hidden = true;
  });
  const decide = async (action) => {
    const comments = box.value.trim();
    if (action === "reject" && !comments) {
      box.classList.add("invalid");
      container.querySelector("#rv-msg").hidden = false;
      box.focus();
      return;
    }
    try {
      await api(`/tenders/${tenderId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comments: comments || null }) });
      onDecided(action === "approve" ? `Tender #${tenderId} approved and published.` : `Tender #${tenderId} rejected and returned to draft.`);
    } catch (err) {
      showResult(resultEl, `Could not ${action} the tender: ` + err.message, false);
    }
  };
  container.querySelector("#rv-approve")?.addEventListener("click", () => decide("approve"));
  container.querySelector("#rv-reject")?.addEventListener("click", () => decide("reject"));
}
