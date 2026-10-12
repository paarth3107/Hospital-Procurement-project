import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime, inr } from "../../lib/format";
import { Tag, StateTag } from "../../components/Tag";
import { useModal } from "../../components/useModal";
import type { AwardTender } from "../../lib/types";
import { AwardLineCard } from "./AwardLineCard";

// Ported 1:1 from frontend/js/pages/awards/tenderAward.js's
// renderTenderAward() -- one tender's award screen: every line with its
// comparative statement, the Officer's recommendation, the Approving
// Authority's decision and the round history. Officer: recommend each
// line, then submit the tender for L1 approval. Approving Authority:
// decide each submitted line.
export function TenderAwardPanel({ tenderId, onBack }: { tenderId: number; onBack: () => void }) {
  const [t, setT] = useState<AwardTender | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { confirmAsync, modalElement } = useModal();

  const load = useCallback(async () => {
    try {
      setT(await api<AwardTender>(`/awards/tenders/${tenderId}`));
      setError("");
    } catch (err) {
      setError("Could not load this tender: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [tenderId]);

  useEffect(() => {
    load();
  }, [load]);

  const onChanged = (message: string) => {
    setFlash(message);
    load();
  };

  const submit = async () => {
    const ok = await confirmAsync("Submit every line's recommendation to the Approving Authority for L1 approval?", { title: "Submit For L1 Approval", confirmLabel: "Submit" });
    if (!ok) return;
    setSubmitting(true);
    try {
      await api(`/awards/tenders/${tenderId}/submit`, { method: "POST" });
      setFlash("Submitted for L1 approval.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !t) return <div className="result err">{error}</div>;
  if (!t) return null;

  return (
    <div className="d-flex flex-col gap-18px">
      <div>
        <button className="ep-b" onClick={onBack}>
          ← All tenders
        </button>
      </div>
      <div className="ep-pane ep-pane-pad d-flex gap-24px items-center flex-wrap">
        <div className="flex-1 minw-260px">
          <div className="ep-k">Tender #{t.tender_id}</div>
          <h4 className="margin-4px-0-3px fs-22px">{t.title}</h4>
          <div className="ep-sub">
            {t.facility_name}
            {t.department ? ` · ${t.department}` : ""}
          </div>
        </div>
        <div>
          <div className="ep-k">Status</div>
          <div className="mt-5px">
            {t.status === "awarded" ? <Tag text="Awarded" tone="pos" /> : t.status === "no_award" ? <Tag text="Nothing awarded" tone="neg" /> : <Tag text="Award in progress" tone="att" />}
          </div>
          {t.awarded_at && <div className="ep-sub">{fmtDateTime(t.awarded_at)}</div>}
        </div>
        {t.required_tier != null && (
          <div>
            <div className="ep-k">Waiting for approval</div>
            <div className="fs-20px fw-800 mt-3px">{inr(t.pending_value)}</div>
            <div className="ep-sub">needs tier {t.required_tier}</div>
          </div>
        )}
      </div>

      {t.status === "awarded" && t.po_files.length > 0 ? (
        <div className="ep-pane">
          <div className="ep-pane-head">
            <span>PO Data Files</span>
          </div>
          <table className="ep-table">
            <tbody>
              {t.po_files.map((f) => (
                <tr key={f.id}>
                  <td className="ep-cell fw-600">{f.batch_id}</td>
                  <td className="ep-cell">{f.vendor_name}</td>
                  <td className="ep-cell">
                    <StateTag state={f.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : t.submit_blockers.length > 0 ? (
        <div className="ep-note">
          {t.submit_blockers.map((b, i) => (
            <div key={i}>{b}</div>
          ))}
        </div>
      ) : null}

      {t.lines.map((l) => (
        <AwardLineCard line={l} onChanged={onChanged} key={l.line_item_id} />
      ))}

      {t.can_submit && (
        <div className="d-flex justify-end">
          <button className="ep-b" data-v="p" disabled={submitting} onClick={submit}>
            Submit for L1 approval
          </button>
        </div>
      )}
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
      {modalElement}
    </div>
  );
}
