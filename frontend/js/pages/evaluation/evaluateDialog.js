import { API_BASE, api, apiHeaders } from "../../api.js";
import { esc, kicker, tag } from "../../kit.js";

// The evaluator's pop-up for one bid. Nothing about the bid is visible in the
// table behind it: the technical content appears only here. Step 1: read the
// bid and open every attached document (the server records each opening and
// refuses to save a score until all are opened). Step 2: score each criterion
// out of 10; the system weights them, and the bid qualifies if the weighted
// score reaches the minimum (or the evaluator disqualifies it outright).
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");
const close = () => {
  overlay.hidden = true;
  box.innerHTML = "";
};

const detailsHtml = (d) =>
  Object.entries(d || {})
    .map(([k, v]) => `<div class="ep-sub">${esc(k.replace(/_/g, " "))}: <b>${esc(v === true ? "yes" : v)}</b></div>`)
    .join("");

function weighted(criteria, scores, rating) {
  let w = 0;
  let t = 0;
  for (const c of criteria) {
    const s = c.auto ? rating / 10 : scores[c.key];
    if (s == null || Number.isNaN(s)) continue;
    w += c.weight;
    t += c.weight * s;
  }
  return w ? t / w : 0;
}

export async function openEvaluateDialog(vendorRow, onSaved) {
  let review;
  try {
    review = await api(`/evaluation/bids/${vendorRow.bid_id}/review`);
  } catch (err) {
    alert("Could not open this bid: " + err.message);
    return;
  }
  const manual = review.criteria.filter((c) => !c.auto);
  const mine = review.my_evaluation;
  const opened = new Set(review.attachments.filter((a) => a.opened).map((a) => a.id));

  box.innerHTML = `
    <div class="dlg-head"><div style="flex:1">${kicker("Technical evaluation")}<h4>${esc(review.vendor_name)}</h4></div></div>
    <form id="eval-form" class="ep-form" style="padding:16px 18px;background:transparent;border:0;max-height:76vh;overflow:auto;gap:16px">
      <div>${kicker("1 · Review the bid")}
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
          ${review.brand_offered ? `<div class="ep-sub">Brand / make: <b>${esc(review.brand_offered)}</b></div>` : ""}${detailsHtml(review.details)}
          ${review.technical_compliance ? `<div style="white-space:pre-wrap;font-size:13px;padding:8px 10px;border:1px solid rgba(32,30,29,.2)"><div class="ep-sub" style="margin-bottom:4px">Compliance statement</div>${esc(review.technical_compliance)}</div>` : '<div class="ep-sub">No compliance statement was written.</div>'}
        </div>
        <div style="margin-top:10px" class="ep-k">Attached documents — open each one before scoring</div>
        <div id="eval-docs" style="margin-top:6px"></div>
      </div>
      <div id="eval-score-block">${kicker("2 · Score each aspect out of 10")}
        <div id="eval-lock" class="hint" style="margin:6px 0"></div>
        <div class="ep-form-grid" style="grid-template-columns:1fr 1fr;margin-top:6px">
          ${review.criteria
            .map((c) =>
              c.auto
                ? `<div class="ep-field">${kicker(`${c.label} (weight ${c.weight}) — automatic`)}<input class="input" value="${(review.rating / 10).toFixed(1)}" disabled></div>`
                : `<div class="ep-field">${kicker(`${c.label} (weight ${c.weight})${c.optional ? " — optional" : " *"}`)}<input class="input" name="score.${c.key}" type="number" min="0" max="10" step="0.5" value="${mine?.scores?.[c.key] ?? ""}" data-score></div>`
            )
            .join("")}
        </div>
        <div id="eval-preview" style="margin-top:10px"></div>
        <label class="ep-check" style="margin-top:10px"><input type="checkbox" name="disqualify" data-score ${mine?.decision === "disqualified" ? "checked" : ""}> Disqualify outright (regardless of score)</label>
        <div class="ep-field" style="margin-top:8px">${kicker("Comments (required to disqualify)")}<textarea class="input" name="comments" rows="3" style="width:100%" data-score>${esc(mine?.comments || "")}</textarea></div>
      </div>
      <div id="eval-result" class="result"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="ep-b" id="eval-cancel">Cancel</button><button class="ep-b" data-v="p" id="eval-save">Save evaluation</button></div>
    </form>`;
  overlay.hidden = false;
  const form = box.querySelector("#eval-form");
  const out = box.querySelector("#eval-result");
  box.querySelector("#eval-cancel").addEventListener("click", close);

  const allOpened = () => review.attachments.every((a) => opened.has(a.id));
  const readScores = () => Object.fromEntries(manual.map((c) => [c.key, form.elements[`score.${c.key}`].value === "" ? null : Number(form.elements[`score.${c.key}`].value)]));

  const refresh = () => {
    // documents
    box.querySelector("#eval-docs").innerHTML = review.attachments.length
      ? review.attachments
          .map(
            (a) => `<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid rgba(32,30,29,.12)">
              <span style="font-size:13px;font-weight:600">${esc(a.original_filename)}</span><span class="ep-sub">${esc(a.label)}</span>
              <span style="margin-left:auto">${opened.has(a.id) ? tag("Opened", "pos") : tag("Not opened", "att")}</span>
              <button type="button" class="ep-b" data-open="${a.id}">${opened.has(a.id) ? "Open again" : "Open"}</button></div>`
          )
          .join("")
      : '<div class="ep-sub">This bid has no attached documents.</div>';
    box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDoc(Number(b.dataset.open))));
    // scoring unlock
    const ok = allOpened();
    form.querySelectorAll("[data-score]").forEach((el) => (el.disabled = !ok));
    box.querySelector("#eval-save").disabled = !ok;
    box.querySelector("#eval-lock").textContent = ok ? "Enter a score for every aspect below. The bid qualifies if the weighted score reaches " + review.min_technical_score + " out of 10." : "Scoring is locked until you have opened every attached document above.";
    preview();
  };

  const preview = () => {
    const typed = readScores();
    const required = manual.filter((c) => !c.optional);
    if (required.some((c) => typed[c.key] == null || Number.isNaN(typed[c.key]))) {
      box.querySelector("#eval-preview").innerHTML = `${kicker("Weighted score")}<div class="ep-sub" style="margin-top:3px">Score every required aspect (*) to see the result.</div>`;
      return;
    }
    const score = weighted(review.criteria, typed, review.rating);
    const pass = score >= review.min_technical_score;
    box.querySelector("#eval-preview").innerHTML = `${kicker("Weighted score")}<div style="font-size:22px;font-weight:800;margin-top:3px">${score.toFixed(2)} <span class="ep-sub" style="font-size:13px;font-weight:600">/ 10 · minimum ${review.min_technical_score} · ${pass ? "would qualify" : "below the minimum"}${review.scored ? " · this line is also T-ranked" : ""}</span></div>`;
  };
  form.addEventListener("input", preview);

  async function openDoc(id) {
    try {
      const res = await fetch(`${API_BASE}/evaluation/bids/${review.bid_id}/attachments/${id}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Could not open the document");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
      opened.add(id); // the server has recorded the opening
      refresh();
    } catch (err) {
      out.className = "result err";
      out.textContent = err.message;
    }
  }

  refresh();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const disq = form.disqualify.checked;
    try {
      await api(`/evaluation/bids/${review.bid_id}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: disq ? "disqualified" : "qualified", scores: disq ? {} : readScores(), comments: form.comments.value }),
      });
      close();
      onSaved(`Evaluation saved for ${review.vendor_name}.`);
    } catch (err) {
      out.className = "result err";
      out.textContent = err.message;
    }
  });
}
