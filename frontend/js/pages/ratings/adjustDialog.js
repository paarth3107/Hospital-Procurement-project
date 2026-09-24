import { api } from "../../api.js";
import { esc, kicker, th, emptyRow, fmtDateTime } from "../../kit.js";

// The "Manual adjustment" dialog for one vendor in one procurement type
// (Procurement Admin only): enter the four manual parameters, with a comment
// (required when a value moves materially), and see the full entry history.
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");

const FIELDS = [
  ["on_time_pct", "On-time delivery %"],
  ["quality_pct", "Quality acceptance %"],
  ["compliance_pct", "Compliance currency %"],
  ["responsiveness", "Responsiveness %"],
];

function close() {
  overlay.hidden = true;
  box.innerHTML = "";
}

export async function openAdjustDialog(vendor, type, rating, onSaved) {
  let history = [];
  try {
    history = (await api(`/ratings/${vendor.id}/history?procurement_type=${type}`)).slice().reverse();
  } catch (err) {
    history = [];
  }
  box.innerHTML = `
    <div class="dlg-head"><div style="flex:1">${kicker(`Manual override · ${type} rating`)}<h4>Adjust rating — ${esc(vendor.legal_name)}</h4></div></div>
    <form id="adjust-form" class="ep-form" style="padding:16px 18px;gap:14px;background:transparent;border:0">
      <div class="hint">Enter only what changed. A change of more than 5 points from the previous value needs a comment; every entry is kept in the history below. Price competitiveness is system-computed and can't be edited here.</div>
      <div class="ep-form-grid" style="grid-template-columns:1fr 1fr">${FIELDS.map(
        ([f, label]) => `<div class="ep-field">${kicker(label)}<input class="input" name="${f}" type="number" step="0.1" min="0" max="100" placeholder="${rating && rating[f] != null ? rating[f] : ""}"></div>`
      ).join("")}</div>
      <div class="ep-field">${kicker("Comment (required for a material change)")}<input class="input" name="comment"></div>
      <div id="adjust-result" class="result"></div>
      <div>${kicker("Entry history")}
        <table class="ep-table" style="margin-top:6px"><thead><tr><th class="ep-th">Field</th><th class="ep-th">Old</th><th class="ep-th">New</th><th class="ep-th">Comment</th><th class="ep-th">When</th></tr></thead><tbody>${
          history.length
            ? history.map((h) => `<tr><td class="ep-cell">${esc(h.field)}</td><td class="ep-cell">${h.old_value ?? "—"}</td><td class="ep-cell">${h.new_value}</td><td class="ep-cell">${esc(h.comment || "")}</td><td class="ep-cell" style="font-size:12px">${fmtDateTime(h.entered_at)}</td></tr>`).join("")
            : emptyRow(5, "No manual entries yet.")
        }</tbody></table></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;border-top:2px solid rgba(32,30,29,.4);padding-top:13px">
        <button type="button" class="ep-b" id="adjust-cancel">Cancel</button>
        <button type="submit" class="ep-b" data-v="p">Save manual ratings</button>
      </div>
    </form>`;
  overlay.hidden = false;

  box.querySelector("#adjust-cancel").addEventListener("click", close);
  box.querySelector("#adjust-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const payload = { procurement_type: type };
    for (const [f] of FIELDS) if (data[f] !== "") payload[f] = Number(data[f]);
    if (data.comment) payload.comment = data.comment;
    const out = box.querySelector("#adjust-result");
    try {
      await api(`/ratings/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      close();
      onSaved(`Manual ${type} ratings saved for ${vendor.legal_name}.`);
    } catch (err) {
      out.className = "result err";
      out.textContent = "Could not save ratings: " + err.message;
    }
  });
}

overlay.addEventListener("click", (e) => {
  if (e.target === overlay && box.querySelector("#adjust-form")) close();
});
