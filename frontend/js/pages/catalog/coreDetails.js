import { fieldHtml, readFields } from "./formKit.js";

// Spec 4.2 core details. Every one is optional and chosen per catalog entry:
// the creator ticks the details that apply to THIS entry (a syringe may not
// need a regulatory class or brand list, an implant does). Unticked rows are
// saved as empty.
const CORE_ROWS = [
  { label: "Unit of measure", fields: [{ name: "unit_of_measure", label: "", kind: "text" }] },
  { label: "Regulatory class (drug schedule / implant class)", fields: [{ name: "regulatory_class", label: "", kind: "text" }] },
  { label: "Preferred / approved brands", fields: [{ name: "approved_brands", label: "", kind: "list" }] },
  { label: "Standard reorder level", fields: [{ name: "reorder_level", label: "", kind: "number" }] },
  {
    label: "Unit price band (reference for bid anomaly checks)",
    fields: [
      { name: "price_band_min", label: "Min", kind: "number" },
      { name: "price_band_max", label: "Max", kind: "number" },
    ],
  },
  {
    label: "Restricted / critical — minimum vendor rating required for mapping",
    fields: [{ name: "min_mapping_rating", label: "Min rating (0–100)", kind: "number" }],
  },
];

const isSet = (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);

export function coreDetailsHtml(product) {
  return CORE_ROWS.map((row, i) => {
    const has = row.fields.some((f) => isSet(product?.[f.name]));
    return `<div class="optional-row" data-row="${i}" style="border-bottom:1px solid rgba(32,30,29,.18);padding:8px 0">
      <label class="optional-toggle ep-check" style="font-weight:600;cursor:pointer"><input type="checkbox" ${has ? "checked" : ""}> ${row.label}</label>
      <div class="optional-input" style="margin:8px 0 2px 24px;display:flex;flex-direction:column;gap:10px" ${has ? "" : "hidden"}>${row.fields.map((f) => fieldHtml(f, product?.[f.name])).join("")}</div>
    </div>`;
  }).join("");
}

export function wireCoreDetails(container) {
  container.querySelectorAll(".optional-row").forEach((row) => {
    const box = row.querySelector(".optional-toggle input");
    box.addEventListener("change", () => (row.querySelector(".optional-input").hidden = !box.checked));
  });
}

// Ticked rows contribute their values; unticked rows are sent as empty so
// editing an entry can remove a detail.
export function readCoreDetails(container) {
  const out = {};
  container.querySelectorAll(".optional-row").forEach((rowEl) => {
    const row = CORE_ROWS[Number(rowEl.dataset.row)];
    const ticked = rowEl.querySelector(".optional-toggle input").checked;
    const values = ticked ? readFields(rowEl, row.fields) : {};
    for (const f of row.fields) out[f.name] = values[f.name] ?? (f.kind === "list" ? [] : null);
  });
  return out;
}
