import { useCallback, useEffect, useState } from "react";
import { loadMappingData, type MappingData } from "../../lib/mappingData";
import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { MappingListTable } from "./MappingListTable";
import { useMappingActions } from "./useMappingActions";

// Ported 1:1 from frontend/js/pages/mappings/mappingRequestsPage.js --
// Vuexy's own User List look: stat cards, then the review queue table
// restyled with an avatar placeholder per vendor row.
const STATE_OPTS: [string, string][] = [
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["suspended", "Suspended"],
  ["rejected", "Rejected"],
  ["", "All"],
];
const SCOPE_OPTS: [string, string][] = [
  ["", "Category & item"],
  ["category", "Category only"],
  ["item", "Item only"],
];

function kpiCells(mappings: MappingData["mappings"]): KpiCell[] {
  const count = (s: string) => mappings.filter((m) => m.state === s).length;
  return [
    ["Total mappings", mappings.length, "category & item mappings", null, "layers", "primary"],
    ["Pending", count("pending"), "awaiting your decision", null, "clock", "warning"],
    ["Approved", count("approved"), "eligible for tenders", null, "user-check", "success"],
    ["Suspended / rejected", count("suspended") + count("rejected"), "not eligible", null, "shield", "danger"],
  ];
}

export function MappingRequestsPage() {
  const [data, setData] = useState<MappingData | null>(null);
  const [error, setError] = useState("");
  const [stateFilter, setStateFilter] = useState("pending");
  const [scopeFilter, setScopeFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await loadMappingData();
      setData(d);
      setError("");
    } catch (err) {
      setError("Could not load mappings: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const actions = useMappingActions(load);

  if (error && !data) return <div className="result err">{error}</div>;
  if (!data) return null;

  return (
    <div className="d-flex flex-col gap-16px">
      <KpiStrip cells={kpiCells(data.mappings)} />
      <div className="ep-pane">
        <div className="ep-pane-head">
          <span>Mapping Requests</span>
          <span className="d-flex items-center gap-14px">
            <label className="ep-k">
              State{" "}
              <select className="input w-auto" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                {STATE_OPTS.map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-k">
              Level{" "}
              <select className="input w-auto" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
                {SCOPE_OPTS.map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </span>
        </div>
        <MappingListTable data={data} filters={{ state: stateFilter, scope: scopeFilter }} actions={actions} />
      </div>
      {error && <div className="result err">{error}</div>}
      {actions.error && <div className="result err">{actions.error}</div>}
      {actions.modalElement}
    </div>
  );
}
