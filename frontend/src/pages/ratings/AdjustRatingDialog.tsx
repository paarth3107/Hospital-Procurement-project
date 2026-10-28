import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { toastError, toastSuccess } from "../../lib/toastStore";
import type { ProcurementType, Rating, RatingHistoryEntry, VendorLookup } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";
import { Req } from "../../components/Req";
import { FieldError } from "../../components/FieldError";

// Ported 1:1 from frontend/js/pages/ratings/adjustDialog.js.
const FIELDS: [string, string][] = [
  ["on_time_pct", "On-time delivery %"],
  ["quality_pct", "Quality acceptance %"],
  ["compliance_pct", "Compliance currency %"],
  ["responsiveness", "Responsiveness %"],
];

export function AdjustRatingDialog({
  vendor,
  type,
  rating,
  onClose,
  onSaved,
}: {
  vendor: VendorLookup;
  type: ProcurementType;
  rating: Rating | undefined;
  onClose: () => void;
  onSaved: (message: string, updated: Rating) => void;
}) {
  const [history, setHistory] = useState<RatingHistoryEntry[]>([]);
  // Real bug, found 2026-10-15: a failed fetch here used to render exactly
  // like "no manual entries yet" -- indistinguishable from a vendor that
  // genuinely has no history.
  const [historyError, setHistoryError] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  // Spec §5.3.1 point 4/§12.3 -- unlike the four manual fields above, price
  // competitiveness is system-computed; overriding it is a governed
  // override, never a routine PATCH, so it's a separate action entirely.
  const [overriding, setOverriding] = useState(false);
  const [newScore, setNewScore] = useState("");
  const [overrideJustification, setOverrideJustification] = useState("");
  const [overrideResult, setOverrideResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [overrideFieldErrors, setOverrideFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api<RatingHistoryEntry[]>(`/ratings/${vendor.id}/history?procurement_type=${type}`)
      .then((h) => setHistory(h.slice().reverse()))
      .catch(() => setHistoryError(true));
  }, [vendor.id, type]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { procurement_type: type };
    for (const [f] of FIELDS) if (values[f]) payload[f] = Number(values[f]);
    if (comment) payload.comment = comment;
    try {
      // Real bug, found 2026-10-15: the PATCH response (the updated
      // Rating, per ratings.py's response_model) was discarded -- the
      // caller then had to re-fetch the WHOLE ratings list (plus the
      // vendor list again) just to see the one row that actually changed.
      // Handing it back directly lets RatingsPage patch just that one
      // vendor's entry in place instead.
      const updated = await api<Rating>(`/ratings/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      onClose();
      toastSuccess(`Manual ${type} ratings saved for ${vendor.legal_name}.`);
      onSaved(`Manual ${type} ratings saved for ${vendor.legal_name}.`, updated);
    } catch (err) {
      const message = `Could not save ratings for ${vendor.legal_name}: ` + (err instanceof Error ? err.message : String(err));
      setError(message);
      toastError(message);
    }
  };

  function checkOverrideScore(v: string) {
    const score = Number(v);
    const err = v === "" || Number.isNaN(score) || score < 0 || score > 100 ? "Score must be 0 to 100." : "";
    setOverrideFieldErrors((prev) => ({ ...prev, score: err }));
    return err;
  }
  function checkOverrideJustification(v: string) {
    const err = v.trim() ? "" : "A justification is required.";
    setOverrideFieldErrors((prev) => ({ ...prev, justification: err }));
    return err;
  }

  const submitOverride = async () => {
    setOverrideResult(null);
    // Collects both errors at once rather than stopping at the first --
    // standardized 2026-10-27, user-directed.
    const scoreErr = checkOverrideScore(newScore);
    const justificationErr = checkOverrideJustification(overrideJustification);
    if (scoreErr || justificationErr) return;
    const score = Number(newScore);
    try {
      const res = await api<{ override_id: number; status: string; required_approver_role: string | null }>(`/ratings/${vendor.id}/price-competitiveness-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procurement_type: type, new_score: score, justification: overrideJustification.trim() }),
      });
      const okMessage = `Price competitiveness override for ${vendor.legal_name} sent to ${res.required_approver_role?.replace(/_/g, " ") ?? "the approver"} for a decision.`;
      setOverrideResult({ message: `Sent to ${res.required_approver_role?.replace(/_/g, " ") ?? "the approver"} for a decision.`, ok: true });
      toastSuccess(okMessage);
      setNewScore("");
      setOverrideJustification("");
      setOverrideFieldErrors({});
      setOverriding(false);
    } catch (err) {
      const message = `Could not request a price competitiveness override for ${vendor.legal_name}: ` + (err instanceof Error ? err.message : String(err));
      setOverrideResult({ message: err instanceof Error ? err.message : String(err), ok: false });
      toastError(message);
    }
  };

  return (
    <DialogShell kicker={`Manual override · ${type} rating`} title={`Adjust Rating — ${vendor.legal_name}`}>
      <form className="ep-form padding-16px-18px gap-14px bg-transparent border-0" onSubmit={submit}>
        <div className="hint">
          Enter only what changed. A change of more than 5 points from the previous value needs a comment; every entry is kept in the history below. Price
          competitiveness is system-computed and can't be edited here.
        </div>
        <div className="ep-pane padding-12px-14px">
          <div className="d-flex items-center justify-between gap-10px">
            <div>
              <div className="ep-k">Price competitiveness (system-computed)</div>
              <div className="fs-15px fw-700 mt-2px">
                {rating?.price_competitiveness != null ? `${rating.price_competitiveness.toFixed(1)} / 100` : "No bid history yet"}
              </div>
            </div>
            {!overriding && (
              <button type="button" className="ep-b" onClick={() => setOverriding(true)}>
                Override
              </button>
            )}
          </div>
          {overriding && (
            <div className="mt-10px">
              <div className="hint">
                Spec §5.3.1/§12.3 -- this is a governed override, not a routine edit. It won't change the score until approved.
              </div>
              <div className="ep-field mt-8px">
                <div className="ep-k">
                  New score
                  <Req />
                </div>
                <input
                  className="input"
                  type="number"
                  step={0.1}
                  min={0}
                  max={100}
                  value={newScore}
                  onChange={(e) => {
                    setNewScore(e.target.value);
                    if (overrideFieldErrors.score) checkOverrideScore(e.target.value);
                  }}
                  onBlur={(e) => checkOverrideScore(e.target.value)}
                />
                <FieldError errors={overrideFieldErrors} name="score" />
              </div>
              <div className="ep-field mt-8px">
                <div className="ep-k">
                  Justification
                  <Req />
                </div>
                <input
                  className="input w-full"
                  value={overrideJustification}
                  onChange={(e) => {
                    setOverrideJustification(e.target.value);
                    if (overrideFieldErrors.justification) checkOverrideJustification(e.target.value);
                  }}
                  onBlur={(e) => checkOverrideJustification(e.target.value)}
                />
                <FieldError errors={overrideFieldErrors} name="justification" />
              </div>
              {overrideResult && <div className={`result ${overrideResult.ok ? "ok" : "err"} mt-8px`}>{overrideResult.message}</div>}
              <div className="d-flex justify-end gap-10px mt-10px">
                <button type="button" className="ep-b" onClick={() => { setOverriding(false); setOverrideFieldErrors({}); }}>
                  Cancel
                </button>
                <button type="button" className="ep-b" data-v="p" onClick={submitOverride}>
                  Request override
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="ep-form-grid grid-cols-1fr-1fr">
          {FIELDS.map(([f, label]) => (
            <div className="ep-field" key={f}>
              <div className="ep-k">{label}</div>
              <input
                className="input"
                type="number"
                step={0.1}
                min={0}
                max={100}
                placeholder={rating && rating[f as keyof Rating] != null ? String(rating[f as keyof Rating]) : ""}
                value={values[f] ?? ""}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="ep-field">
          <div className="ep-k">Comment (required for a material change)</div>
          <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        {error && <div className="result err">{error}</div>}
        <div>
          <div className="ep-k">Entry history</div>
          <table className="ep-table mt-6px">
            <thead>
              <tr>
                {["Field", "Old", "New", "Comment", "When"].map((h) => (
                  <th className="ep-th" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyError ? (
                <tr>
                  <td className="ep-cell text-danger-700" colSpan={5}>
                    Could not load entry history — try closing and reopening this dialog.
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td className="ep-cell text-ink-55" colSpan={5}>
                    No manual entries yet.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id}>
                    <td className="ep-cell">{h.field}</td>
                    <td className="ep-cell">{h.old_value ?? "—"}</td>
                    <td className="ep-cell">{h.new_value}</td>
                    <td className="ep-cell">{h.comment || ""}</td>
                    <td className="ep-cell fs-12px">{fmtDateTime(h.entered_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="d-flex justify-end gap-10px border-top-2px-solid-ink-40 pt-13px">
          <button type="button" className="ep-b" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ep-b" data-v="p">
            Save manual ratings
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
