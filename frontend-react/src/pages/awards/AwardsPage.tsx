import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { inr } from "../../lib/format";
import { takePendingAwardId } from "../../lib/bridge";
import { Tag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { AwardTenderSummary } from "../../lib/types";
import { STATE } from "./awardHelpers";
import { TenderAwardPanel } from "./TenderAwardPanel";

// Ported 1:1 from frontend/js/pages/awards/awardsPage.js -- L1 award
// (Module 6-7): tenders whose technical evaluation has closed. The Officer
// recommends per line and submits; the Approving Authority decides; when
// every line is decided the tender is Awarded and the PO data files are
// generated.
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);

export function AwardsPage() {
  const [allTenders, setAllTenders] = useState<AwardTenderSummary[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setAllTenders(await api<AwardTenderSummary[]>("/awards/tenders"));
      setError("");
    } catch (err) {
      setError("Could not load the award stage: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  // Opened via the Approving Authority dashboard's pipeline (same deep-link
  // pattern as Vendor View/Tender Editor/Approvals) -- take it before the
  // list's own fetch so this mount opens straight into the tender.
  useEffect(() => {
    const id = takePendingAwardId();
    if (id != null) setSelected(id);
    else load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (selected != null) {
    return (
      <TenderAwardPanel
        tenderId={selected}
        onBack={() => {
          setSelected(null);
          load();
        }}
      />
    );
  }

  if (error && !allTenders.length) return <div className="result err">{error}</div>;

  const closedCount = allTenders.filter((t) => CLOSED_TENDER_STATUSES.has(t.status)).length;
  const filtered = showClosed ? allTenders : allTenders.filter((t) => !CLOSED_TENDER_STATUSES.has(t.status));
  const { pageItems, totalPages, page: clampedPage } = pageSlice(filtered, page);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Tenders At The Award Stage</span>
        <label className="d-flex items-center gap-6px fs-12px fw-400 tt-none ls-0 text-ink-70">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => {
              setShowClosed(e.target.checked);
              setPage(0);
            }}
          />{" "}
          Show closed/awarded ({closedCount})
        </label>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Tender", "Status", "Lines", "Award value", "", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!pageItems.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={6}>
                {showClosed ? "No tender has reached the award stage yet." : "Nothing in progress. Closed tenders are hidden -- tick the box above to see them."}
              </td>
            </tr>
          ) : (
            pageItems.map((t) => {
              const chips = Object.entries(t.counts)
                .map(([k, n]) => `${n} ${STATE[k as keyof typeof STATE] ? STATE[k as keyof typeof STATE][0].toLowerCase() : k}`)
                .join(" · ");
              return (
                <tr key={t.tender_id}>
                  <td className="ep-cell">
                    <div className="fw-700">#{t.tender_id}</div>
                    <div className="ep-sub">{t.title}</div>
                  </td>
                  <td className="ep-cell">
                    {t.status === "awarded" ? <Tag text="Awarded" tone="pos" /> : t.status === "no_award" ? <Tag text="Nothing awarded" tone="neg" /> : <Tag text="In progress" tone="att" />}
                  </td>
                  <td className="ep-cell fs-12-5px">{chips}</td>
                  <td className="ep-cell fs-12-5px">
                    {t.required_tier ? (
                      <>
                        {inr(t.pending_value)}
                        <div className="ep-sub">tier {t.required_tier}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="ep-cell">{t.waiting_for_you && <Tag text="Waiting for you" tone="att" />}</td>
                  <td className="ep-cell text-right">
                    <button className="ep-b" data-v="p" onClick={() => setSelected(t.tender_id)}>
                      Open
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <Pagination page={clampedPage} totalPages={totalPages} onChange={setPage} />
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
