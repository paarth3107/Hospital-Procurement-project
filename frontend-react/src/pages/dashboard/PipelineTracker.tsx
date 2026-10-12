import { Icon } from "../../lib/icons";
import { Donut } from "../../components/Donut";
import type { ChartPalette } from "../../lib/charts";

// Shared "Vuexy-style support tracker" pane -- a donut beside a row per
// stage -- used identically (just with different stage data and a different
// subtitle) by all four dashboards: the generic/System Admin one and the
// Officer's, Category Manager's and Approving Authority's own. Ported from
// the near-identical tracker()/stages()/drawStageChart() trio duplicated
// across dashboardPage.js, officerDashboard.js, categoryManagerDashboard.js
// and approvingAuthorityDashboard.js -- collapsed into one component here
// per CLAUDE.md's "centralize... rather than duplicating workflow logic
// across modules" (each vanilla file had an exact copy of this pane's markup).
export interface StageRow {
  label: string;
  icon: string;
  tone: string;
  note: string;
  count: number;
}

export function PipelineTracker({ subtitle, stages, pickColors }: { subtitle: string; stages: StageRow[]; pickColors: (p: ChartPalette) => (string | undefined)[] }) {
  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Procurement Pipeline</span>
        <span className="ep-k">{subtitle}</span>
      </div>
      <div className="ep-pane-pad d-flex flex-wrap gap-24px items-center">
        <div className="flex-1 minw-0">
          <Donut labels={stages.map((s) => s.label)} series={stages.map((s) => s.count)} pickColors={pickColors} height={240} />
        </div>
        <div className="d-flex flex-col gap-16px flex-1 minw-0">
          {stages.map((s, i) => (
            <div className="d-flex items-center gap-12px" key={i}>
              <span className={`ep-kpi-icon tone-${s.tone}`}>
                <Icon name={s.icon} size={20} />
              </span>
              <div className="flex-1 minw-0">
                <div className="fw-600">{s.label}</div>
                <div className="ep-sub">{s.note}</div>
              </div>
              <span className="fw-800 fs-16px">{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
