import { api } from "../../api.js";
import { state } from "../../state.js";
import { showResult } from "../../ui.js";
import { scorecardHtml, WEIGHTS } from "./scorecard.js";
import { openAdjustDialog } from "./adjustDialog.js";

// ---- Vendor rating & scorecard (Module 3): the weight-model strip, then a
// scorecard per vendor. A vendor is rated separately per procurement type,
// so the segment control switches which type's scores are shown. ----
const root = () => document.getElementById("ratings-root");
const resultEl = () => document.getElementById("rating-result");

let type = "item";
let vendors = [];
let ratingByVendor = new Map();

const TYPES = [["item", "Items"], ["asset", "Assets"], ["service", "Services"]];

function weightStrip() {
  return `<div class="ep-pane" style="padding:16px 18px;display:flex;gap:26px;align-items:center">
    <div style="flex:none"><div class="ep-k">Weighted model</div><div style="font-size:13px;font-weight:800;margin-top:3px">Price competitiveness is system-computed · the rest entered by Procurement Admin</div></div>
    <div style="flex:1;display:flex;gap:1px;background:rgba(32,30,29,.3)">${WEIGHTS.map(
      ([pct, label, flex]) => `<div style="flex:${flex};background:#f3f2f2;padding:8px 10px"><div style="font-size:15px;font-weight:800">${pct}</div><div style="font-size:10.5px;line-height:1.3;color:rgba(32,30,29,.65)">${label}</div></div>`
    ).join("")}</div>
  </div>`;
}

function render() {
  const canAdjust = state.user?.role === "procurement_admin";
  const cards = vendors.length
    ? vendors.map((v) => scorecardHtml(v, ratingByVendor.get(v.id), type, canAdjust)).join("")
    : '<div class="ep-pane ep-pane-pad hint">No vendors to rate yet.</div>';
  root().innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div class="ep-seg">${TYPES.map(([k, l]) => `<button data-type="${k}" class="${k === type ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="hint">A vendor holds a separate rating for each procurement type — strong at Items doesn't make them strong at Services.</div>
    </div>
    ${weightStrip()}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${cards}</div>
  </div>`;
  root().querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => ((type = b.dataset.type), load())));
  root().querySelectorAll("[data-adjust]").forEach((b) =>
    b.addEventListener("click", () => {
      const v = vendors.find((x) => x.id === Number(b.dataset.adjust));
      openAdjustDialog(v, type, ratingByVendor.get(v.id), (msg) => {
        showResult(resultEl(), msg, true);
        load();
      });
    })
  );
}

async function load() {
  try {
    const [vs, ratings] = await Promise.all([api("/vendors/lookup"), api(`/ratings?procurement_type=${type}`)]);
    vendors = vs;
    ratingByVendor = new Map(ratings.map((r) => [r.vendor_id, r]));
    render();
  } catch (err) {
    showResult(resultEl(), "Could not load ratings: " + err.message, false);
  }
}

export function loadRatingsPage() {
  return load();
}
