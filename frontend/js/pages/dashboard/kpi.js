import { esc, kicker } from "../../kit.js";
import { icon } from "../../icons.js";

// One KPI tile per [label, value, sub, view?, iconName, tone]. A tile with a
// view is a button that opens that page; tone picks the tint of its icon.
function tile([label, value, sub, view, ic, tone = "primary"]) {
  const inner = `<div class="d-flex justify-between items-start gap-12px">
      <div class="minw-0">${kicker(label)}<div class="ep-kpi-value">${esc(value)}</div><div class="ep-sub">${esc(sub)}</div></div>
      <span class="ep-kpi-icon tone-${tone}">${icon(ic, 20)}</span>
    </div>`;
  return view ? `<button type="button" class="ep-kpi" data-view="${view}">${inner}</button>` : `<div class="ep-kpi">${inner}</div>`;
}

export function kpiStrip(cells) {
  return `<div class="ep-kpis">${cells.map(tile).join("")}</div>`;
}
