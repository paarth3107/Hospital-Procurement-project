import { useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Tag } from "../../components/Tag";
import { useModal } from "../../components/useModal";
import type { CurrentUser, LateSubmission, LineDetail, VendorBidRow } from "../../lib/types";
import { CommercialStatement } from "./CommercialStatement";
import { EvaluateDialog } from "./EvaluateDialog";

// Ported 1:1 from frontend/js/pages/evaluation/lineDetail.js -- one line's
// evaluation card: who was invited and has submitted (all that anyone may
// see before the deadline), then, after it, the technical envelope only.
// Prices are not part of this card at all.
const PHASE: Record<LineDetail["summary"]["phase"], [string, "att" | "esc" | "pos"]> = {
  bidding_open: ["Bidding open", "att"],
  technical_evaluation: ["Technical evaluation", "esc"],
  technical_closed: ["Technical closed", "pos"],
};

const canSeePrices = (detail: LineDetail, currentUser: CurrentUser | null) =>
  detail.summary.phase === "technical_closed" && (currentUser ? ["procurement_officer", "system_admin"].includes(currentUser.role) : false);

function EvaluationCell({ row, detail }: { row: VendorBidRow; detail: LineDetail }) {
  // Only evaluators see (their own) evaluations; nothing about bid content is shown in this table.
  if (!row.submitted || !detail.can_see_evaluations) return null;
  const mine = row.evaluations.find((e) => e.mine);
  const others = detail.technical_closed_at ? row.evaluations.filter((e) => !e.mine) : [];
  const shown = [...(mine ? [mine] : []), ...others];
  return (
    <>
      {shown.length ? (
        shown.map((e, i) => (
          <div className="fs-12-5px" key={i}>
            {e.evaluator}: <Tag text={e.decision} tone={e.decision === "qualified" ? "pos" : "neg"} />
            {e.weighted_score != null && (
              <>
                {" "}
                <b>{e.weighted_score}</b>
                <span className="ep-sub">/100</span>
              </>
            )}
            {e.comments && <div className="ep-sub">{e.comments}</div>}
          </div>
        ))
      ) : (
        <span className="ep-sub">Not evaluated by you</span>
      )}
      <div className="ep-sub">{row.evaluation_count} evaluator(s) have evaluated</div>
    </>
  );
}

function ResultCell({ row }: { row: VendorBidRow }) {
  const r = row.result;
  if (!r) return null;
  return (
    <>
      <Tag text={r.outcome} tone={r.outcome === "qualified" ? "pos" : "neg"} />
      {r.t_rank && (
        <>
          {" "}
          <b>T{r.t_rank}</b>
        </>
      )}
      {r.consolidated_score != null && <div className="ep-sub">score {r.consolidated_score} / 100</div>}
      {r.reason && <div className="ep-sub maxw-220px">{r.reason}</div>}
    </>
  );
}

// Spec §8.4 -- a bid that arrived after the deadline is held as
// PENDING_LATE_EXCEPTION, not rejected outright (app/services/bids.py's
// assert_can_bid); invisible everywhere else on this page (the vendors
// table above is SUBMITTED-only). Can't file this itself (a vendor's late
// bid alone can't; OverrideRequest.initiator_id is a staff FK) -- whoever's
// looking at this line has to see it and request the exception on the
// vendor's behalf.
const LATE_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pending Category Manager's decision",
  escalated: "Escalated to Approving Authority",
  rejected: "Declined -- bid stays excluded unless requested again",
};

function LateSubmissionRow({
  row,
  tenderId,
  lineId,
  onReload,
  onResult,
}: {
  row: LateSubmission;
  tenderId: number;
  lineId: number;
  onReload: () => void;
  onResult: (message: string, ok: boolean) => void;
}) {
  const [reasonCode, setReasonCode] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);

  const request = async () => {
    if (!reasonCode.trim() || !justification.trim()) return onResult("A reason code and justification are both required.", false);
    setBusy(true);
    try {
      const res = await api<{ status: string; required_approver_role: string | null }>(
        `/tenders/${tenderId}/lines/${lineId}/bids/${row.bid_id}/late-submission-exception`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason_code: reasonCode.trim(), justification: justification.trim() }) }
      );
      onResult(`Sent to ${res.required_approver_role?.replace(/_/g, " ") ?? "the approver"} for a decision.`, true);
      onReload();
    } catch (err) {
      onResult(err instanceof Error ? err.message : String(err), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="d-flex items-center gap-10px flex-wrap mt-6px">
      <div className="flex-1 minw-160px">
        <div className="fw-600 fs-12-5px">{row.vendor_name}</div>
        <div className="ep-sub">Submitted {fmtDateTime(row.submitted_at)} -- after the deadline</div>
      </div>
      {row.can_request ? (
        <>
          <input className="input" placeholder="Reason code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
          <input className="input" placeholder="Justification" value={justification} onChange={(e) => setJustification(e.target.value)} />
          <button type="button" className="ep-b" disabled={busy} onClick={request}>
            Request exception
          </button>
        </>
      ) : (
        <Tag text={LATE_STATUS_LABEL[row.override_status ?? ""] ?? row.override_status ?? "Pending"} tone="esc" />
      )}
    </div>
  );
}

export function LineBlock({ detail, currentUser, onReload, onResult }: { detail: LineDetail; currentUser: CurrentUser | null; onReload: () => void; onResult: (message: string, ok: boolean) => void }) {
  const s = detail.summary;
  const [phaseLabel, phaseTone] = PHASE[s.phase];
  const seePrices = canSeePrices(detail, currentUser);
  const [evaluating, setEvaluating] = useState<VendorBidRow | null>(null);
  const [correcting, setCorrecting] = useState<VendorBidRow | null>(null);
  const [closing, setClosing] = useState(false);
  const { confirmAsync, modalElement } = useModal();

  const closeTechnical = async () => {
    const ok = await confirmAsync("Record qualification and rank the qualified bids for this line? After this, scores can't be changed without a governed override.", {
      title: "Close Technical Evaluation",
      confirmLabel: "Close evaluation",
    });
    if (!ok) return;
    setClosing(true);
    try {
      await api(`/evaluation/lines/${s.line_item_id}/close-technical`, { method: "POST" });
      onReload();
      onResult("Technical evaluation closed.", true);
    } catch (err) {
      onResult(err instanceof Error ? err.message : String(err), false);
      setClosing(false);
    }
  };

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>{s.product_name}</span>
        <span className="ep-k">
          {s.qty} · {s.procurement_type}
          {s.technical_eval_method !== "qualify_disqualify" ? " · scored" : ""} · <Tag text={phaseLabel} tone={phaseTone} />
        </span>
      </div>
      <div className="padding-12px-18px-0">
        {s.phase === "bidding_open" && (
          <div className="ep-note">Bids are sealed. Until the due date you can see only who has submitted; technical content and prices stay hidden from everyone.</div>
        )}
        {detail.can_see_evaluations &&
          (detail.scored ? (
            <>
              <div className="ep-k mt-6px">Scored out of 100 · minimum qualifying score {detail.min_technical_score} · qualified bids are T-ranked</div>
              <div className="d-flex flex-wrap gap-8px-22px mt-4px">
                {detail.criteria.map((c) => (
                  <div className="ep-sub" key={c.key}>
                    <b>{c.weight}%</b> {c.label}
                    {c.auto ? " (from rating)" : c.optional ? " (optional)" : ""}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="ep-k mt-6px">Qualify / disqualify — checked against mandatory technical compliance points, no score. Qualified bids stand on equal footing.</div>
          ))}
      </div>
      <div className="padding-12px-18px-0">
        <div className="ep-sub mb-4px">
          {s.submitted_count} of {s.invited_count} submitted
        </div>
        <table className="ep-table">
          <thead>
            <tr>
              {["Vendor", "Submission", "Your evaluation", "Result", ""].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!detail.vendors.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={5}>
                  No vendors were invited to this line.
                </td>
              </tr>
            ) : (
              detail.vendors.map((r) => (
                <tr key={r.vendor_id}>
                  <td className="ep-cell">
                    <div className="fw-600">{r.vendor_name}</div>
                    <div className="ep-sub">rating {r.rating}</div>
                  </td>
                  <td className="ep-cell">
                    {r.submitted ? <Tag text="Submitted" tone="pos" /> : <Tag text="Not submitted" tone="att" />}
                    {r.submitted_at && <div className="ep-sub">{fmtDateTime(r.submitted_at)}</div>}
                  </td>
                  <td className="ep-cell">
                    <EvaluationCell row={r} detail={detail} />
                  </td>
                  <td className="ep-cell">
                    <ResultCell row={r} />
                  </td>
                  <td className="ep-cell text-right">
                    {detail.can_evaluate && r.submitted && (
                      <button className="ep-b" data-v="p" onClick={() => setEvaluating(r)}>
                        Evaluate
                      </button>
                    )}
                    {/* Spec §9.2.4/§12.3 Technical Score Correction -- once closed,
                        only the evaluator who recorded their own decision on this
                        bid can request a correction to it (request_evaluation_
                        correction's own guard; the AwardRound/already-closed checks
                        there are the authoritative ones, this is just discovery). */}
                    {detail.can_see_evaluations && detail.technical_closed_at && r.evaluations.some((e) => e.mine) && (
                      <button className="ep-b" onClick={() => setCorrecting(r)}>
                        Correct
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {detail.late_submissions.length > 0 && (
        <div className="padding-0-18px-14px">
          <div className="ep-note warn">Submitted after the deadline -- excluded from evaluation unless admitted through a governed exception.</div>
          {detail.late_submissions.map((row) => (
            <LateSubmissionRow key={row.bid_id} row={row} tenderId={s.tender_id} lineId={s.line_item_id} onReload={onReload} onResult={onResult} />
          ))}
        </div>
      )}
      <div className="padding-14px-18px-18px">
        {s.phase === "technical_closed" ? (
          <>
            <div className="ep-note">
              Technical evaluation is closed and qualification is recorded.
              {!seePrices && " Prices of the qualified bids are opened to the Procurement Officer for commercial evaluation."}
            </div>
            {seePrices && (
              <div className="mt-12px">
                <CommercialStatement lineId={s.line_item_id} onError={(msg) => onResult(msg, false)} />
              </div>
            )}
          </>
        ) : (
          detail.can_evaluate && (
            <div className="d-flex justify-end">
              <button className="ep-b" data-v="p" disabled={closing} onClick={closeTechnical}>
                Close technical evaluation
              </button>
            </div>
          )
        )}
      </div>
      {evaluating && (
        <EvaluateDialog
          vendorRow={evaluating}
          onClose={() => setEvaluating(null)}
          onSaved={(msg) => {
            setEvaluating(null);
            onReload();
            onResult(msg, true);
          }}
        />
      )}
      {correcting && (
        <EvaluateDialog
          vendorRow={correcting}
          mode="correct"
          onClose={() => setCorrecting(null)}
          onSaved={(msg) => {
            setCorrecting(null);
            onReload();
            onResult(msg, true);
          }}
        />
      )}
      {modalElement}
    </div>
  );
}
