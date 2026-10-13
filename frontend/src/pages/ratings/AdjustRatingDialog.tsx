import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import type { ProcurementType, Rating, RatingHistoryEntry, VendorLookup } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";

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
  onSaved: (message: string) => void;
}) {
  const [history, setHistory] = useState<RatingHistoryEntry[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<RatingHistoryEntry[]>(`/ratings/${vendor.id}/history?procurement_type=${type}`)
      .then((h) => setHistory(h.slice().reverse()))
      .catch(() => setHistory([]));
  }, [vendor.id, type]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { procurement_type: type };
    for (const [f] of FIELDS) if (values[f]) payload[f] = Number(values[f]);
    if (comment) payload.comment = comment;
    try {
      await api(`/ratings/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      onClose();
      onSaved(`Manual ${type} ratings saved for ${vendor.legal_name}.`);
    } catch (err) {
      setError("Could not save ratings: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <DialogShell kicker={`Manual override · ${type} rating`} title={`Adjust Rating — ${vendor.legal_name}`}>
      <form className="ep-form padding-16px-18px gap-14px bg-transparent border-0" onSubmit={submit}>
        <div className="hint">
          Enter only what changed. A change of more than 5 points from the previous value needs a comment; every entry is kept in the history below. Price
          competitiveness is system-computed and can't be edited here.
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
              {history.length === 0 ? (
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
