import { useCallback, useEffect, useMemo, useState } from "react";
import { api, API_BASE, apiHeaders } from "../lib/api";
import { fmtDateTime, roleLabel, actionLabel } from "../lib/format";
import type { AuditFilterOptions, AuditFilters, AuditLogPageData, AuditLogRow } from "../lib/types";
import { EMPTY_FILTERS } from "../lib/types";
import { AuditDetailDialog } from "./AuditDetailDialog";

// Ported 1:1 from frontend/js/pages/audit/auditPage.js (Phase 0 pilot of the
// React migration -- see .claude-notes/REACT-MIGRATION-PLAN.md). Every fix
// made to this page this session carries over: fixed px column widths
// (table-layout: fixed, scoped via .audit-table so no other .ep-table is
// affected), centered cells, the Domain → Verb action-label format, Apply
// before Reset, Role as its own plain column.
//
// Filter inputs are deliberately uncontrolled-feeling: typing doesn't
// refetch anything. A local "draft" state holds what's in the inputs; only
// Apply (or Enter in the search box) copies it into `filters`, which is what
// actually drives the query -- matching the vanilla page's readFilters()
// timing exactly.

const AUDIT_COLS: Array<[string, number]> = [
  ["When", 150],
  ["Who", 170],
  ["Role", 170],
  ["Action", 240],
  ["Record", 240],
  ["Reason / change", 220],
  ["", 110],
];
const RECORD_TYPE: Record<string, string> = { auth: "Sign-in" };
const REASON_PREVIEW = 70;

function summary(row: AuditLogRow): string {
  if (row.reason) return row.reason;
  const a = row.after_state;
  if (a && typeof a.status === "string") return `→ ${a.status.replace(/_/g, " ")}`;
  if (a && typeof a.state === "string") return `→ ${a.state}`;
  return "";
}

export function AuditLogPage() {
  const [data, setData] = useState<AuditLogPageData>({ items: [], total: 0, page: 1, page_size: 50 });
  const [options, setOptions] = useState<AuditFilterOptions>({ entity_types: [], actions: [] });
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [expandedReasons, setExpandedReasons] = useState<Set<number>>(new Set());
  const [detailRow, setDetailRow] = useState<AuditLogRow | null>(null);
  const [error, setError] = useState("");

  const query = useCallback(
    (extra: Record<string, string | number> = {}) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v !== "" && v != null) p.set(k, String(v));
      return p.toString();
    },
    [filters]
  );

  const load = useCallback(async () => {
    try {
      const [d, o] = await Promise.all([
        api<AuditLogPageData>(`/audit-log?${query({ page, page_size: 50 })}`),
        api<AuditFilterOptions>("/audit-log/filters"),
      ]);
      setData(d);
      setOptions(o);
      setError("");
    } catch (err) {
      setError("Could not load the audit log: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [query, page]);

  useEffect(() => {
    load();
  }, [load]);

  const applyFilters = () => {
    setFilters(draft);
    setPage(1);
  };
  const resetFilters = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const exportCsv = async () => {
    try {
      const res = await fetch(`${API_BASE}/audit-log/export?${query()}`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not export");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const recordTypeOptions = useMemo(() => options.entity_types.map((v): [string, string] => [v, RECORD_TYPE[v] || v]), [options.entity_types]);
  const actionOptions = useMemo(() => options.actions.map((v): [string, string] => [v, actionLabel(v)]), [options.actions]);

  const toggleReason = (id: number) =>
    setExpandedReasons((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Audit Log</span>
        <span className="ep-k">{data.total} entries · read-only</span>
      </div>
      <div className="ep-pane-pad border-bottom-1px-solid-ink-18 filter-grid">
        <div className="ep-field filter-wide">
          <div className="ep-k">Search</div>
          <input
            className="input"
            placeholder="Name, record or reason"
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>
        <Select label="Record type" placeholder="All" value={draft.entity_type} options={recordTypeOptions} onChange={(v) => setDraft({ ...draft, entity_type: v })} />
        <Select label="Action" placeholder="All" value={draft.action} options={actionOptions} onChange={(v) => setDraft({ ...draft, action: v })} />
        <Select
          label="Who"
          placeholder="Anyone"
          value={draft.actor_type}
          options={[
            ["staff", "Staff"],
            ["vendor", "Vendors"],
            ["system", "System"],
            ["anonymous", "Not signed in"],
          ]}
          onChange={(v) => setDraft({ ...draft, actor_type: v })}
        />
        <div className="ep-field">
          <div className="ep-k">From</div>
          <input className="input" type="date" value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} />
        </div>
        <div className="ep-field">
          <div className="ep-k">To</div>
          <input className="input" type="date" value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} />
        </div>
        <div className="filter-actions">
          <button className="ep-b" data-v="p" onClick={applyFilters}>
            Apply
          </button>
          <button className="ep-b" onClick={resetFilters}>
            Reset
          </button>
          <button className="ep-b" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="ep-table audit-table">
          <thead>
            <tr>
              {AUDIT_COLS.map(([label, px]) => (
                <th className="ep-th" style={{ width: px }} key={label || "actions"}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={7}>
                  No entries match these filters.
                </td>
              </tr>
            ) : (
              data.items.map((r) => {
                const text = summary(r);
                const open = expandedReasons.has(r.id);
                const long = text.length > REASON_PREVIEW;
                return (
                  <tr key={r.id}>
                    <td className="ep-cell fs-12px nowrap">{fmtDateTime(r.occurred_at)}</td>
                    <td className="ep-cell fw-600">{r.actor_type === "system" ? "System" : r.actor_name || "—"}</td>
                    <td className="ep-cell">{roleLabel(r.actor_role || r.actor_type)}</td>
                    <td className="ep-cell">
                      {actionLabel(r.action)}
                      {r.imported && <span className="ep-tag">imported</span>}
                    </td>
                    <td className="ep-cell fw-600">{r.entity_label || `${r.entity_type} #${r.entity_id ?? ""}`}</td>
                    <td className="ep-cell ep-sub maxw-280px">
                      {long ? (open ? text : `${text.slice(0, REASON_PREVIEW)}…`) : text}
                      {long && (
                        <>
                          {" "}
                          <button className="ep-link" onClick={() => toggleReason(r.id)}>
                            {open ? "Show less" : "Read more"}
                          </button>
                        </>
                      )}
                    </td>
                    <td className="ep-cell text-right">
                      <button className="ep-b" onClick={() => setDetailRow(r)}>
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="padding-10px-14px d-flex gap-10px items-center justify-end">
        <span className="ep-sub">
          Page {page} of {pages}
        </span>
        <button className="ep-b" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button className="ep-b" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
      {error && <div className="result err">{error}</div>}
      {detailRow && <AuditDetailDialog row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  );
}

function Select({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="ep-field">
      <div className="ep-k">{label}</div>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
