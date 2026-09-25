import { esc, kicker } from "../../kit.js";
import { qualifiedRows, topRow } from "./awardHelpers.js";

// The Procurement Officer's recommendation for one line (spec 9.5): confirm the
// system's L1/C1, recommend a different qualified vendor (reason mandatory),
// propose a split (Split-Award lines only), or leave the line out of the award
// (reason mandatory). Saved as a draft; the whole tender is submitted afterwards.
export function recommendationFormHtml(line) {
  const rows = qualifiedRows(line);
  const top = topRow(line);
  const cur = line.current && ["draft", "rejected"].includes(line.current.status) ? line.current : null;
  const others = rows.filter((r) => r.bid_id !== top?.bid_id);
  const canSplit = line.split_award_allowed && rows.length >= 2;
  const mode = cur?.kind === "exclude" ? "exclude" : cur && cur.proposed.length > 1 ? "split" : cur?.is_override ? "other" : "top";
  const proposed = new Map((cur?.proposed || []).map((a) => [a.bid_id, a.share_pct]));
  const radio = (v, label, extra = "") => `<label class="ep-check" style="align-items:flex-start;margin-top:8px"><input type="radio" name="mode-${line.line_item_id}" value="${v}" ${mode === v ? "checked" : ""} ${rows.length === 0 && v !== "exclude" ? "disabled" : ""}><span>${label}${extra}</span></label>`;
  return `<div data-rec="${line.line_item_id}" style="margin-top:12px;padding:12px 14px;border:1px solid rgba(32,30,29,.3)">
    ${kicker("Your recommendation")}
    ${rows.length === 0 ? '<div class="hint" style="margin-top:6px">No technically qualified bid on this line. It can only be left out of the award.</div>' : ""}
    ${radio("top", `Confirm the system's ${top ? esc(top.rank_label) : "L1"} recommendation`, top ? ` — <b>${esc(top.vendor_name)}</b>` : "")}
    ${radio("other", "Recommend a different vendor instead")}
    <div data-panel="other" style="margin:6px 0 0 26px" hidden>
      <select class="input" name="other-bid">${others.map((r) => `<option value="${r.bid_id}" ${proposed.has(r.bid_id) && mode === "other" ? "selected" : ""}>${esc(r.rank_label)} — ${esc(r.vendor_name)} (${r.landed_unit_price})</option>`).join("")}</select>
    </div>
    ${canSplit ? radio("split", "Propose a split between vendors", ` <span class="ep-sub">(each share at least ${line.min_split_pct}%, total 100%)</span>`) : ""}
    ${
      canSplit
        ? `<div data-panel="split" style="margin:6px 0 0 26px" hidden>${rows
            .map((r) => `<div style="display:flex;gap:10px;align-items:center;margin-top:4px"><span style="min-width:230px;font-size:13px">${esc(r.rank_label)} — ${esc(r.vendor_name)}</span><input class="input" style="width:90px" type="number" min="0" max="100" step="1" name="share-${r.bid_id}" value="${proposed.get(r.bid_id) ?? ""}" placeholder="%"> <span class="ep-sub">%</span></div>`)
            .join("")}<div class="ep-sub" id="split-total-${line.line_item_id}" style="margin-top:4px"></div></div>`
        : ""
    }
    ${radio("exclude", "Leave this line out of the award")}
    <div class="ep-field" style="margin-top:10px">${kicker("Reason")}<textarea class="input" name="reason" rows="2" style="width:100%" placeholder="Required if you recommend a different vendor or leave the line out">${esc(cur?.officer_reason || "")}</textarea>
      <div class="hint" data-reason-msg style="color:#ae1800;margin-top:4px" hidden>A reason is mandatory for this choice.</div></div>
    <div id="rec-result-${line.line_item_id}" class="result"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="ep-b" data-v="p" data-save-rec="${line.line_item_id}">Save recommendation</button></div>
  </div>`;
}

// Reads the panel back into the API's shape; returns null (and highlights the
// reason box) when a mandatory reason is missing.
export function readRecommendation(panel, line) {
  const mode = panel.querySelector(`input[name="mode-${line.line_item_id}"]:checked`)?.value || "top";
  const reasonEl = panel.querySelector('[name="reason"]');
  const reason = reasonEl.value.trim();
  if ((mode === "other" || mode === "exclude") && !reason) {
    reasonEl.classList.add("invalid");
    panel.querySelector("[data-reason-msg]").hidden = false;
    reasonEl.focus();
    return null;
  }
  if (mode === "other") return { mode: "other_vendor", bid_id: Number(panel.querySelector('[name="other-bid"]').value), reason };
  if (mode === "split") {
    const allocations = qualifiedRows(line)
      .map((r) => ({ bid_id: r.bid_id, share_pct: Number(panel.querySelector(`[name="share-${r.bid_id}"]`).value || 0) }))
      .filter((a) => a.share_pct > 0);
    return { mode: "split", allocations, reason: reason || null };
  }
  if (mode === "exclude") return { mode: "exclude", reason };
  return { mode: "confirm_top", reason: reason || null };
}

export function wireRecommendation(panel, line) {
  const show = () => {
    const mode = panel.querySelector(`input[name="mode-${line.line_item_id}"]:checked`)?.value;
    panel.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== mode));
    const total = panel.querySelector(`#split-total-${line.line_item_id}`);
    if (total) {
      const sum = qualifiedRows(line).reduce((s, r) => s + Number(panel.querySelector(`[name="share-${r.bid_id}"]`)?.value || 0), 0);
      total.textContent = `Total: ${sum}%`;
      total.style.color = Math.abs(sum - 100) < 0.01 ? "inherit" : "#ae1800";
    }
  };
  panel.addEventListener("input", show);
  panel.addEventListener("change", show);
  panel.querySelector('[name="reason"]').addEventListener("input", (e) => {
    e.target.classList.remove("invalid");
    panel.querySelector("[data-reason-msg]").hidden = true;
  });
  show();
}
