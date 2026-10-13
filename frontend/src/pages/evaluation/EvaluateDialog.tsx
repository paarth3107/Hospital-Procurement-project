import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, API_BASE, apiHeaders } from "../../lib/api";
import { Tag } from "../../components/Tag";
import type { BidReview, Criterion, VendorBidRow } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/evaluation/evaluateDialog.js -- the
// evaluator's pop-up for one bid. Nothing about the bid is visible in the
// table behind it: the technical content appears only here. Step 1: read
// the bid and open every attached document (the server records each
// opening and refuses to save an evaluation until all are opened). Step 2
// depends on the line's evaluation method (spec §9.2.1): a Scored/QCBS
// line scores each criterion out of 100 and the system weights them,
// qualifying if the weighted score reaches the minimum; a plain
// Qualify/Disqualify line is a genuine pass/fail toggle with no score
// behind it at all. Own portal -- never the vanilla app's shared
// #app-dialog/#app-dialog-box nodes, same as every other ported dialog.
function detailsEntries(d: Record<string, unknown> | null | undefined): [string, string][] {
  return Object.entries(d || {}).map(([k, v]) => [k.replace(/_/g, " "), v === true ? "yes" : String(v)]);
}

function weighted(criteria: Criterion[], scores: Record<string, number | null>, rating: number): number {
  let w = 0;
  let t = 0;
  for (const c of criteria) {
    const s = c.auto ? rating : scores[c.key];
    if (s == null || Number.isNaN(s)) continue;
    w += c.weight;
    t += c.weight * s;
  }
  return w ? t / w : 0;
}

export function EvaluateDialog({ vendorRow, onClose, onSaved }: { vendorRow: VendorBidRow; onClose: () => void; onSaved: (message: string) => void }) {
  const [review, setReview] = useState<BidReview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [scoresRaw, setScoresRaw] = useState<Record<string, string>>({});
  const [disqualify, setDisqualify] = useState(false);
  const [qdDecision, setQdDecision] = useState<"qualified" | "disqualified">("qualified");
  const [comments, setComments] = useState("");
  const [commentsInvalid, setCommentsInvalid] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<BidReview>(`/evaluation/bids/${vendorRow.bid_id}/review`)
      .then((r) => {
        setReview(r);
        setOpened(new Set(r.attachments.filter((a) => a.opened).map((a) => a.id)));
        const mine = r.my_evaluation;
        setDisqualify(mine?.decision === "disqualified");
        setQdDecision(mine?.decision === "disqualified" ? "disqualified" : "qualified");
        setComments(mine?.comments || "");
        const raw: Record<string, string> = {};
        for (const c of r.criteria.filter((c) => !c.auto)) raw[c.key] = mine?.scores?.[c.key] != null ? String(mine.scores[c.key]) : "";
        setScoresRaw(raw);
      })
      .catch((err) => setLoadError("Could not open this bid: " + (err instanceof Error ? err.message : String(err))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorRow.bid_id]);

  const manual = useMemo(() => review?.criteria.filter((c) => !c.auto) ?? [], [review]);
  const allOpened = review ? review.attachments.every((a) => opened.has(a.id)) : false;

  const openDoc = async (id: number) => {
    if (!review) return;
    try {
      const res = await fetch(`${API_BASE}/evaluation/bids/${review.bid_id}/attachments/${id}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Could not open the document");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
      setOpened((prev) => new Set(prev).add(id)); // the server has recorded the opening
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const readScores = (): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const c of manual) out[c.key] = scoresRaw[c.key] === "" || scoresRaw[c.key] === undefined ? null : Number(scoresRaw[c.key]);
    return out;
  };

  const preview = () => {
    if (!review?.scored) return null;
    const typed = readScores();
    const required = manual.filter((c) => !c.optional);
    if (required.some((c) => typed[c.key] == null || Number.isNaN(typed[c.key]!))) {
      return (
        <>
          <div className="ep-k">Weighted score</div>
          <div className="ep-sub mt-3px">Score every required aspect (*) to see the result.</div>
        </>
      );
    }
    const score = weighted(review.criteria, typed, review.rating);
    const pass = score >= review.min_technical_score;
    return (
      <>
        <div className="ep-k">Weighted score</div>
        <div className="fs-22px fw-800 mt-3px">
          {score.toFixed(2)}{" "}
          <span className="ep-sub fs-13px fw-600">
            / 100 · minimum {review.min_technical_score} · {pass ? "would qualify" : "below the minimum"} · this line is also T-ranked
          </span>
        </div>
      </>
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!review) return;
    const disq = review.scored ? disqualify : qdDecision === "disqualified";
    if (disq && !comments.trim()) {
      setCommentsInvalid(true);
      return;
    }
    setSaving(true);
    try {
      await api(`/evaluation/bids/${review.bid_id}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: disq ? "disqualified" : "qualified", scores: !disq && review.scored ? readScores() : {}, comments }),
      });
      onSaved(`Evaluation saved for ${review.vendor_name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  if (loadError) {
    return createPortal(
      <div className="dialog-overlay">
        <div className="dialog-box">
          <div className="dlg-head">
            <div className="flex-1">
              <h4>Could not open this bid</h4>
            </div>
          </div>
          <div className="padding-16px-18px">
            <div className="result err">{loadError}</div>
            <div className="d-flex justify-end mt-12px">
              <button className="ep-b" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }
  if (!review) return null;

  const locked = !allOpened;

  return createPortal(
    <div className="dialog-overlay">
      <div className="dialog-box">
        <div className="dlg-head">
          <div className="flex-1">
            <div className="ep-k">Technical evaluation</div>
            <h4>{review.vendor_name}</h4>
          </div>
        </div>
        <form className="ep-form padding-16px-18px bg-transparent border-0 maxh-76vh overflow-auto gap-16px" onSubmit={submit}>
          <div>
            <div className="ep-k">1 · Review the bid</div>
            <div className="mt-8px d-flex flex-col gap-6px">
              {review.brand_offered && (
                <div className="ep-sub">
                  Brand / make: <b>{review.brand_offered}</b>
                </div>
              )}
              {detailsEntries(review.details).map(([k, v]) => (
                <div className="ep-sub" key={k}>
                  {k}: <b>{v}</b>
                </div>
              ))}
              {review.compliant_full ? (
                <div className="ep-sub">Vendor confirms full compliance — no deviations declared.</div>
              ) : review.technical_compliance ? (
                <div className="pre-wrap fs-13px padding-8px-10px border-1px-solid-ink-20">
                  <div className="ep-sub mb-4px">Deviations from the specification</div>
                  {review.technical_compliance}
                </div>
              ) : (
                <div className="ep-sub">No compliance statement was given.</div>
              )}
            </div>
            <div className="ep-k mt-10px">Attached documents — open each one before scoring</div>
            <div className="mt-6px">
              {review.attachments.length ? (
                review.attachments.map((a) => (
                  <div className="d-flex gap-10px items-center padding-5px-0 border-bottom-1px-solid-ink-12" key={a.id}>
                    <span className="fs-13px fw-600">{a.original_filename}</span>
                    <span className="ep-sub">{a.label}</span>
                    <span className="ml-auto">{opened.has(a.id) ? <Tag text="Opened" tone="pos" /> : <Tag text="Not opened" tone="att" />}</span>
                    <button type="button" className="ep-b" onClick={() => openDoc(a.id)}>
                      {opened.has(a.id) ? "Open again" : "Open"}
                    </button>
                  </div>
                ))
              ) : (
                <div className="ep-sub">This bid has no attached documents.</div>
              )}
            </div>
          </div>
          <div>
            {review.scored ? (
              <>
                <div className="ep-k">2 · Score each aspect out of 100</div>
                <div className="hint margin-6px-0">
                  {locked
                    ? "This is locked until you have opened every attached document above."
                    : `Enter a score for every aspect below. The bid qualifies if the weighted score reaches ${review.min_technical_score} out of 100.`}
                </div>
                <div className="ep-form-grid grid-cols-1fr-1fr mt-6px">
                  {review.criteria.map((c) =>
                    c.auto ? (
                      <div className="ep-field" key={c.key}>
                        <div className="ep-k">
                          {c.label} (weight {c.weight}) — automatic
                        </div>
                        <input className="input" value={review.rating.toFixed(1)} disabled />
                      </div>
                    ) : (
                      <div className="ep-field" key={c.key}>
                        <div className="ep-k">
                          {c.label} (weight {c.weight}){c.optional ? " — optional" : " *"}
                        </div>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          disabled={locked}
                          value={scoresRaw[c.key] ?? ""}
                          onChange={(e) => setScoresRaw((s) => ({ ...s, [c.key]: e.target.value }))}
                        />
                      </div>
                    )
                  )}
                </div>
                <div className="mt-10px">{preview()}</div>
                <label className="ep-check mt-10px">
                  <input type="checkbox" disabled={locked} checked={disqualify} onChange={(e) => setDisqualify(e.target.checked)} /> Disqualify outright (regardless of score)
                </label>
              </>
            ) : (
              <>
                <div className="ep-k">2 · Decision</div>
                <div className="hint margin-6px-0">
                  {locked
                    ? "This is locked until you have opened every attached document above."
                    : "Check the bid against the mandatory technical compliance points and qualify or disqualify it — no score involved."}
                </div>
                <div className="d-flex gap-20px mt-8px">
                  <label className="ep-check">
                    <input type="radio" disabled={locked} checked={qdDecision === "qualified"} onChange={() => setQdDecision("qualified")} /> Qualify — meets the mandatory
                    technical compliance points
                  </label>
                  <label className="ep-check">
                    <input type="radio" disabled={locked} checked={qdDecision === "disqualified"} onChange={() => setQdDecision("disqualified")} /> Disqualify
                  </label>
                </div>
              </>
            )}
            <div className="ep-field mt-8px">
              <div className="ep-k">Comments (if any)</div>
              <textarea
                className={`input w-full${commentsInvalid ? " invalid" : ""}`}
                rows={3}
                disabled={locked}
                value={comments}
                onChange={(e) => {
                  setComments(e.target.value);
                  setCommentsInvalid(false);
                }}
              />
              {commentsInvalid && <div className="hint mt-4px text-danger-700">A reason is mandatory to disqualify a bid.</div>}
            </div>
          </div>
          {error && <div className="result err">{error}</div>}
          <div className="d-flex justify-end gap-10px">
            <button type="button" className="ep-b" onClick={onClose}>
              Cancel
            </button>
            <button className="ep-b" data-v="p" disabled={locked || saving} type="submit">
              Save evaluation
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
