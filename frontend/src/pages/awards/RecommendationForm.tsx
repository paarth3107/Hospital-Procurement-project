import { useState } from "react";
import type { AwardLine, RecommendationSave } from "../../lib/types";
import { qualifiedRows, topRow } from "./awardHelpers";

// Ported 1:1 from frontend/js/pages/awards/recommendationForm.js -- the
// Procurement Officer's recommendation for one line (spec 9.5): confirm the
// system's L1/C1, recommend a different qualified vendor (reason
// mandatory), propose a split (Split-Award lines only), or leave the line
// out of the award (reason mandatory). Saved as a draft; the whole tender
// is submitted afterwards.
type Mode = "top" | "other" | "split" | "exclude";

export function RecommendationForm({ line, onSave, saving, error }: { line: AwardLine; onSave: (body: RecommendationSave) => void; saving: boolean; error: string }) {
  const rows = qualifiedRows(line);
  const top = topRow(line);
  const cur = line.current && ["draft", "rejected"].includes(line.current.status) ? line.current : null;
  const others = rows.filter((r) => r.bid_id !== top?.bid_id);
  const canSplit = line.split_award_allowed && rows.length >= 2;
  const initialMode: Mode = cur?.kind === "exclude" ? "exclude" : cur && cur.proposed.length > 1 ? "split" : cur?.is_override ? "other" : "top";
  const initialProposed = new Map((cur?.proposed || []).map((a) => [a.bid_id, a.share_pct]));

  const [mode, setMode] = useState<Mode>(initialMode);
  const [otherBid, setOtherBid] = useState<string>(initialProposed.size && initialMode === "other" ? String([...initialProposed.keys()][0]) : String(others[0]?.bid_id ?? ""));
  const [shares, setShares] = useState<Record<number, string>>(() => {
    const s: Record<number, string> = {};
    for (const r of rows) s[r.bid_id] = initialProposed.has(r.bid_id) ? String(initialProposed.get(r.bid_id)) : "";
    return s;
  });
  const [reason, setReason] = useState(cur?.officer_reason || "");
  const [reasonInvalid, setReasonInvalid] = useState(false);

  const splitTotal = rows.reduce((s, r) => s + Number(shares[r.bid_id] || 0), 0);

  const save = () => {
    const trimmedReason = reason.trim();
    if ((mode === "other" || mode === "exclude") && !trimmedReason) {
      setReasonInvalid(true);
      return;
    }
    let body: RecommendationSave;
    if (mode === "other") body = { mode: "other_vendor", bid_id: Number(otherBid), reason: trimmedReason };
    else if (mode === "split") {
      const allocations = rows.map((r) => ({ bid_id: r.bid_id, share_pct: Number(shares[r.bid_id] || 0) })).filter((a) => a.share_pct > 0);
      body = { mode: "split", allocations, reason: trimmedReason || null };
    } else if (mode === "exclude") body = { mode: "exclude", reason: trimmedReason };
    else body = { mode: "confirm_top", reason: trimmedReason || null };
    onSave(body);
  };

  return (
    <div className="mt-12px padding-12px-14px border-1px-solid-ink-30">
      <div className="ep-k">Your recommendation</div>
      {rows.length === 0 && <div className="hint mt-6px">No technically qualified bid on this line. It can only be left out of the award.</div>}
      <label className="ep-check items-start mt-8px">
        <input type="radio" disabled={rows.length === 0} checked={mode === "top"} onChange={() => setMode("top")} />
        <span>
          Confirm the system's {top ? top.rank_label : "L1"} recommendation
          {top && (
            <>
              {" "}
              — <b>{top.vendor_name}</b>
            </>
          )}
        </span>
      </label>
      <label className="ep-check items-start mt-8px">
        <input type="radio" disabled={rows.length === 0} checked={mode === "other"} onChange={() => setMode("other")} />
        <span>Recommend a different vendor instead</span>
      </label>
      {mode === "other" && (
        <div className="margin-6px-0-0-26px">
          <select className="input" value={otherBid} onChange={(e) => setOtherBid(e.target.value)}>
            {others.map((r) => (
              <option value={r.bid_id} key={r.bid_id}>
                {r.rank_label} — {r.vendor_name} ({r.landed_unit_price})
              </option>
            ))}
          </select>
        </div>
      )}
      {canSplit && (
        <label className="ep-check items-start mt-8px">
          <input type="radio" checked={mode === "split"} onChange={() => setMode("split")} />
          <span>
            Propose a split between vendors <span className="ep-sub">(each share at least {line.min_split_pct}%, total 100%)</span>
          </span>
        </label>
      )}
      {canSplit && mode === "split" && (
        <div className="margin-6px-0-0-26px">
          {rows.map((r) => (
            <div className="d-flex gap-10px items-center mt-4px" key={r.bid_id}>
              <span className="minw-230px fs-13px">
                {r.rank_label} — {r.vendor_name}
              </span>
              <input
                className="input w-90px"
                type="number"
                min={0}
                max={100}
                step={1}
                placeholder="%"
                value={shares[r.bid_id] ?? ""}
                onChange={(e) => setShares((s) => ({ ...s, [r.bid_id]: e.target.value }))}
              />{" "}
              <span className="ep-sub">%</span>
            </div>
          ))}
          <div className={`ep-sub mt-4px${Math.abs(splitTotal - 100) < 0.01 ? "" : " text-danger-700"}`}>Total: {splitTotal}%</div>
        </div>
      )}
      <label className="ep-check items-start mt-8px">
        <input type="radio" checked={mode === "exclude"} onChange={() => setMode("exclude")} />
        <span>Leave this line out of the award</span>
      </label>
      <div className="ep-field mt-10px">
        <div className="ep-k">Reason</div>
        <textarea
          className={`input w-full${reasonInvalid ? " invalid" : ""}`}
          rows={2}
          placeholder="Required if you recommend a different vendor or leave the line out"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonInvalid(false);
          }}
        />
        {reasonInvalid && <div className="hint text-danger-700 mt-4px">A reason is mandatory for this choice.</div>}
      </div>
      {error && <div className="result err">{error}</div>}
      <div className="d-flex justify-end mt-8px">
        <button className="ep-b" data-v="p" disabled={saving} onClick={save}>
          Save recommendation
        </button>
      </div>
    </div>
  );
}
