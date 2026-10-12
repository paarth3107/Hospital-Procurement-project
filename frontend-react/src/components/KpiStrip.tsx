import { Icon } from "../lib/icons";
import { switchView } from "../lib/bridge";

// Ported from frontend/js/pages/dashboard/kpi.js. [label, value, sub, view, iconName, tone].
// A tile with a `view` navigates the (still-vanilla) shell there on click.
export type KpiCell = [string, string | number, string, string | null, string, string?];

function Tile({ cell: [label, value, sub, view, ic, tone = "primary"] }: { cell: KpiCell }) {
  const inner = (
    <div className="d-flex justify-between items-start gap-12px">
      <div className="minw-0">
        <div className="ep-k">{label}</div>
        <div className="ep-kpi-value">{value}</div>
        <div className="ep-sub">{sub}</div>
      </div>
      <span className={`ep-kpi-icon tone-${tone}`}>
        <Icon name={ic} size={20} />
      </span>
    </div>
  );
  return view ? (
    <button type="button" className="ep-kpi" onClick={() => switchView(view)}>
      {inner}
    </button>
  ) : (
    <div className="ep-kpi">{inner}</div>
  );
}

export function KpiStrip({ cells }: { cells: KpiCell[] }) {
  return (
    <div className="ep-kpis">
      {cells.map((c, i) => (
        <Tile cell={c} key={i} />
      ))}
    </div>
  );
}
