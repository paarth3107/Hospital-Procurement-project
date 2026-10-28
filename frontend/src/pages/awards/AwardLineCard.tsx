import { useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { toastError, toastSuccess } from "../../lib/toastStore";
import { Tag } from "../../components/Tag";
import type { AwardLine, AwardRound, DecisionIn, RecommendationSave } from "../../lib/types";
import { Allocations, DECISION_LABEL, STATE, StatementTable } from "./awardHelpers";
import { RecommendationForm } from "./RecommendationForm";
import { DecisionForm } from "./DecisionForm";

// Ported 1:1 from frontend/js/pages/awards/tenderAward.js's lineHtml() +
// round history + the two forms' save wiring -- one line with its
// comparative statement, the Officer's recommendation, the Approving
// Authority's decision and the round history.
function RoundHistoryEntry({ r }: { r: AwardRound }) {
  const dec = r.decision_kind ? `${DECISION_LABEL[r.decision_kind] || r.decision_kind}${r.decided_by ? ` by ${r.decided_by}` : ""}${r.decided_at ? ` · ${fmtDateTime(r.decided_at)}` : ""}` : "";
  return (
    <div className="padding-6px-0 border-top-1px-solid-ink-12 fs-12-5px">
      <b>Round {r.round_number}</b> <Tag text={r.status} tone={r.status === "approved" ? "pos" : r.status === "rejected" ? "neg" : "att"} />{" "}
      {r.kind === "exclude" ? "· left out of the award" : ""}
      <div>
        {r.kind !== "exclude" && (
          <>
            Officer: <Allocations allocs={r.proposed} />
          </>
        )}
        {r.is_override && <Tag text="override" tone="att" />}
      </div>
      {r.officer_reason && <div className="ep-sub">Reason: {r.officer_reason}</div>}
      {dec && <div>{dec}</div>}
      {r.final.length > 0 && (
        <div>
          Final: <Allocations allocs={r.final} />
        </div>
      )}
      {r.decision_comments && <div className="ep-sub">Comments: {r.decision_comments}</div>}
    </div>
  );
}

export function AwardLineCard({ line, onChanged }: { line: AwardLine; onChanged: (message: string) => void }) {
  const [label, tone] = STATE[line.state];
  const c = line.current;
  const [editingRec, setEditingRec] = useState(line.state !== "draft"); // non-draft recommendation forms always show; draft starts collapsed behind "Edit recommendation"
  const [recError, setRecError] = useState("");
  const [decError, setDecError] = useState("");
  const [saving, setSaving] = useState(false);
  const older = line.history.filter((r) => !c || r.round_number !== c.round_number);

  const saveRecommendation = async (body: RecommendationSave) => {
    setSaving(true);
    setRecError("");
    try {
      await api(`/awards/lines/${line.line_item_id}/recommendation`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const message = `Recommendation saved for ${line.product_name}.`;
      toastSuccess(message);
      onChanged(message);
    } catch (err) {
      const message = `Could not save the recommendation for ${line.product_name}: ` + (err instanceof Error ? err.message : String(err));
      setRecError(err instanceof Error ? err.message : String(err));
      toastError(message);
      setSaving(false);
    }
  };

  const saveDecision = async (body: DecisionIn) => {
    setSaving(true);
    setDecError("");
    try {
      await api(`/awards/lines/${line.line_item_id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const message = body.decision === "reject" ? `Returned ${line.product_name} to the Officer.` : `Decision recorded for ${line.product_name}.`;
      toastSuccess(message);
      onChanged(message);
    } catch (err) {
      const message = `Could not record the decision for ${line.product_name}: ` + (err instanceof Error ? err.message : String(err));
      setDecError(err instanceof Error ? err.message : String(err));
      toastError(message);
      setSaving(false);
    }
  };

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>
          {line.product_name} <span className="ep-sub fw-400">
            {line.product_code} · {line.qty}
            {line.uom ? " " + line.uom : ""}
          </span>
        </span>
        <span>
          <Tag text={label} tone={tone} />
        </span>
      </div>
      <div className="padding-14px-16px">
        <div className="ep-sub">
          {line.evaluation_method.replace(/_/g, " ")}
          {line.split_award_allowed ? " · split award allowed" : ""}
        </div>
        {line.technical_closed ? <StatementTable line={line} /> : <div className="hint mt-8px">Technical evaluation is not closed for this line yet.</div>}
        {c && line.state !== "none" && (
          <div className="mt-10px fs-13px">
            <div className="ep-k">Round {c.round_number}</div>
            <div className="mt-3px">
              {c.kind === "exclude" ? (
                "Recommended: leave this line out of the award"
              ) : (
                <>
                  Recommended: <Allocations allocs={c.proposed} />
                </>
              )}
              {c.is_override && <Tag text="not the system's top-ranked" tone="att" />}
            </div>
            {c.officer_reason && <div className="ep-sub pre-wrap">Reason: {c.officer_reason}</div>}
            {(line.state === "approved" || line.state === "excluded") && (
              <div className="mt-4px fw-600">
                {DECISION_LABEL[c.decision_kind || ""] || ""} — {c.kind === "exclude" ? "no award" : <Allocations allocs={c.final} />}
              </div>
            )}
            {c.decision_comments && <div className="ep-sub">Approver's comments: {c.decision_comments}</div>}
          </div>
        )}
        {older.length > 0 && (
          <details className="mt-8px">
            <summary className="ep-sub cursor-pointer">Earlier rounds ({older.length})</summary>
            {older.map((r) => (
              <RoundHistoryEntry r={r} key={r.round_number} />
            ))}
          </details>
        )}
        {line.can_recommend &&
          (line.state === "draft" ? (
            <>
              <div className="mt-10px">
                <button className="ep-b" onClick={() => setEditingRec((v) => !v)}>
                  {editingRec ? "Close editor" : "Edit recommendation"}
                </button>
              </div>
              {editingRec && <RecommendationForm line={line} onSave={saveRecommendation} saving={saving} error={recError} />}
            </>
          ) : (
            <RecommendationForm line={line} onSave={saveRecommendation} saving={saving} error={recError} />
          ))}
        {line.can_decide && c && <DecisionForm line={line} onSave={saveDecision} saving={saving} error={decError} />}
      </div>
    </div>
  );
}
