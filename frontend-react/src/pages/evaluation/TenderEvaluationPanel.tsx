import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import type { CurrentUser, TenderEvalDetail } from "../../lib/types";
import { LineBlock } from "./LineBlock";

// Ported 1:1 from frontend/js/pages/evaluation/tenderEvaluation.js -- one
// tender's evaluation screen: every published line of the tender together,
// one screen, mirroring the Awards and E-Tender-Approval screens' own
// tender-grouped layout. A single call (GET /evaluation/tenders/{id})
// already returns every line's full detail, so this is a pure render +
// per-line wiring, no per-line fetch.
export function TenderEvaluationPanel({ tenderId, onBack }: { tenderId: number; onBack: () => void }) {
  const [detail, setDetail] = useState<TenderEvalDetail | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<{ message: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api<TenderEvalDetail>(`/evaluation/tenders/${tenderId}`));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [tenderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<CurrentUser>("/auth/me")
      .then(setCurrentUser)
      .catch(() => {});
  }, []);

  const onResult = (message: string, ok: boolean) => setFlash({ message, ok });

  if (error && !detail) return <div className="result err">{error}</div>;
  if (!detail) return null;

  return (
    <div className="d-flex flex-col gap-18px">
      <div>
        <button className="ep-b" onClick={onBack}>
          ← All tenders
        </button>
      </div>
      <div className="ep-pane ep-pane-pad d-flex gap-24px items-center flex-wrap">
        <div className="flex-1 minw-260px">
          <div className="ep-k">
            Tender #{detail.tender_id} · {detail.tender_type.toUpperCase()} · {detail.facility_name}
          </div>
          <h4 className="margin-4px-0-3px fs-21px">{detail.tender_title}</h4>
          <div className="ep-sub">{detail.lines.length} line(s)</div>
        </div>
        <div>
          <div className="ep-k">Bids close</div>
          <div className="fw-700 mt-3px">{fmtDateTime(detail.bid_due_date)}</div>
        </div>
      </div>
      {detail.lines.map((l) => (
        <LineBlock detail={l} currentUser={currentUser} onReload={load} onResult={onResult} key={l.summary.line_item_id} />
      ))}
      {flash && <div className={`result ${flash.ok ? "ok" : "err"}`}>{flash.message}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
