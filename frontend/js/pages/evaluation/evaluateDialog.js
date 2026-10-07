import { API_BASE, api, apiHeaders } from "../../api.js";
import { esc, kicker, tag } from "../../kit.js";

// The evaluator's pop-up for one bid. Nothing about the bid is visible in the
// table behind it: the technical content appears only here. Step 1: read the
// bid and open every attached document (the server records each opening and
// refuses to save an evaluation until all are opened). Step 2 depends on the
// line's evaluation method (spec §9.2.1): a Scored/QCBS line scores each
// criterion out of 100 and the system weights them, qualifying if the
// weighted score reaches the minimum; a plain Qualify/Disqualify line is a
// genuine pass/fail toggle with no score behind it at all (user-directed
// 2026-09-28 -- a vendor's syringe is either the right size or it isn't).
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
    const s = c.auto ? rating : scores[c.key];
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
    <div class="dlg-head"><div class="flex-1">${kicker("Technical evaluation")}<h4>${esc(review.vendor_name)}</h4></div></div>
    <form id="eval-form" class="ep-form padding-16px-18px bg-transparent border-0 maxh-76vh overflow-auto gap-16px">
      <div>${kicker("1 · Review the bid")}
        <div class="mt-8px d-flex flex-col gap-6px">
          ${review.brand_offered ? `<div class="ep-sub">Brand / make: <b>${esc(review.brand_offered)}</b></div>` : ""}${detailsHtml(review.details)}
          ${
            review.compliant_full
              ? '<div class="ep-sub">Vendor confirms full compliance — no deviations declared.</div>'
              : review.technical_compliance
              ? `<div class="pre-wrap fs-13px padding-8px-10px border-1px-solid-ink-20"><div class="ep-sub mb-4px">Deviations from the specification</div>${esc(review.technical_compliance)}</div>`
              : '<div class="ep-sub">No compliance statement was given.</div>'
          }
        </div>
        <div class="ep-k mt-10px">Attached documents — open each one before scoring</div>
        <div id="eval-docs" class="mt-6px"></div>
      </div>
      <div id="eval-score-block">${
        review.scored
          ? `${kicker("2 · Score each aspect out of 100")}
        <div id="eval-lock" class="hint margin-6px-0"></div>
        <div class="ep-form-grid grid-cols-1fr-1fr mt-6px">
          ${review.criteria
            .map((c) =>
              c.auto
                ? `<div class="ep-field">${kicker(`${c.label} (weight ${c.weight}) — automatic`)}<input class="input" value="${review.rating.toFixed(1)}" disabled></div>`
                : `<div class="ep-field">${kicker(`${c.label} (weight ${c.weight})${c.optional ? " — optional" : " *"}`)}<input class="input" name="score.${c.key}" type="number" min="0" max="100" step="1" value="${mine?.scores?.[c.key] ?? ""}" data-score></div>`
            )
            .join("")}
        </div>
        <div id="eval-preview" class="mt-10px"></div>
        <label class="ep-check mt-10px"><input type="checkbox" name="disqualify" data-score ${mine?.decision === "disqualified" ? "checked" : ""}> Disqualify outright (regardless of score)</label>`
          : `${kicker("2 · Decision")}
        <div id="eval-lock" class="hint margin-6px-0"></div>
        <div class="d-flex gap-20px mt-8px">
          <label class="ep-check"><input type="radio" name="qd_decision" value="qualified" data-score ${mine?.decision !== "disqualified" ? "checked" : ""}> Qualify — meets the mandatory technical compliance points</label>
          <label class="ep-check"><input type="radio" name="qd_decision" value="disqualified" data-score ${mine?.decision === "disqualified" ? "checked" : ""}> Disqualify</label>
        </div>`
      }
        <div class="ep-field mt-8px">${kicker("Comments (if any)")}<textarea class="input w-full" name="comments" rows="3" data-score>${esc(mine?.comments || "")}</textarea><div id="eval-comments-msg" class="hint mt-4px text-danger-700" hidden>A reason is mandatory to disqualify a bid.</div></div>
      </div>
      <div id="eval-result" class="result"></div>
      <div class="d-flex justify-end gap-10px"><button type="button" class="ep-b" id="eval-cancel">Cancel</button><button class="ep-b" data-v="p" id="eval-save">Save evaluation</button></div>
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
            (a) => `<div class="d-flex gap-10px items-center padding-5px-0 border-bottom-1px-solid-ink-12">
              <span class="fs-13px fw-600">${esc(a.original_filename)}</span><span class="ep-sub">${esc(a.label)}</span>
              <span class="ml-auto">${opened.has(a.id) ? tag("Opened", "pos") : tag("Not opened", "att")}</span>
              <button type="button" class="ep-b" data-open="${a.id}">${opened.has(a.id) ? "Open again" : "Open"}</button></div>`
          )
          .join("")
      : '<div class="ep-sub">This bid has no attached documents.</div>';
    box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDoc(Number(b.dataset.open))));
    // scoring unlock
    const ok = allOpened();
    form.querySelectorAll("[data-score]").forEach((el) => (el.disabled = !ok));
    box.querySelector("#eval-save").disabled = !ok;
    box.querySelector("#eval-lock").textContent = ok
      ? review.scored
        ? "Enter a score for every aspect below. The bid qualifies if the weighted score reaches " + review.min_technical_score + " out of 100."
        : "Check the bid against the mandatory technical compliance points and qualify or disqualify it — no score involved."
      : "This is locked until you have opened every attached document above.";
    preview();
  };

  const preview = () => {
    if (!review.scored) return;
    const typed = readScores();
    const required = manual.filter((c) => !c.optional);
    if (required.some((c) => typed[c.key] == null || Number.isNaN(typed[c.key]))) {
      box.querySelector("#eval-preview").innerHTML = `${kicker("Weighted score")}<div class="ep-sub mt-3px">Score every required aspect (*) to see the result.</div>`;
      return;
    }
    const score = weighted(review.criteria, typed, review.rating);
    const pass = score >= review.min_technical_score;
    box.querySelector("#eval-preview").innerHTML = `${kicker("Weighted score")}<div class="fs-22px fw-800 mt-3px">${score.toFixed(2)} <span class="ep-sub fs-13px fw-600">/ 100 · minimum ${review.min_technical_score} · ${pass ? "would qualify" : "below the minimum"}${review.scored ? " · this line is also T-ranked" : ""}</span></div>`;
  };
  form.addEventListener("input", preview);
  form.comments.addEventListener("input", () => {
    form.comments.classList.remove("invalid");
    box.querySelector("#eval-comments-msg").hidden = true;
  });

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
    const disq = review.scored ? form.disqualify.checked : form.qd_decision.value === "disqualified";
    const msg = box.querySelector("#eval-comments-msg");
    if (disq && !form.comments.value.trim()) {
      form.comments.classList.add("invalid");
      msg.hidden = false;
      form.comments.focus();
      return;
    }
    try {
      await api(`/evaluation/bids/${review.bid_id}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: disq ? "disqualified" : "qualified", scores: !disq && review.scored ? readScores() : {}, comments: form.comments.value }),
      });
      close();
      onSaved(`Evaluation saved for ${review.vendor_name}.`);
    } catch (err) {
      out.className = "result err";
      out.textContent = err.message;
    }
  });
}
