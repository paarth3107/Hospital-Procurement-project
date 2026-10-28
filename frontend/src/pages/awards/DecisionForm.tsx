import { useState } from "react";
import { Tag } from "../../components/Tag";
import type { AwardLine, DecisionIn } from "../../lib/types";
import { Req } from "../../components/Req";
import { FieldError } from "../../components/FieldError";
import { Allocations } from "./awardHelpers";

// Ported 1:1 from frontend/js/pages/awards/decisionForm.js -- the Approving
// Authority's decision on one line (spec 10.2): approve the Officer's
// recommendation (a split can be adjusted), award the system's L1/C1
// instead when the Officer chose someone else, or reject with comments
// (the line returns to the Officer as the next round).
type Decision = "approve" | "award_system_l1" | "reject";

export function DecisionForm({ line, onSave, saving, error }: { line: AwardLine; onSave: (body: DecisionIn) => void; saving: boolean; error: string }) {
  const c = line.current!;
  const canSystem = c.is_override && c.system_top_vendor;
  const split = c.kind === "award" && c.proposed.length > 1;

  const [decision, setDecision] = useState<Decision>("approve");
  const [adjusted, setAdjusted] = useState<Record<number, string>>(() => {
    const s: Record<number, string> = {};
    for (const a of c.proposed) s[a.bid_id] = String(a.share_pct);
    return s;
  });
  const [comments, setComments] = useState("");
  const [commentsInvalid, setCommentsInvalid] = useState(false);

  const save = () => {
    const trimmed = comments.trim();
    if (decision === "reject" && !trimmed) {
      setCommentsInvalid(true);
      return;
    }
    const body: DecisionIn = { decision, comments: trimmed || null };
    if (decision === "approve" && c.proposed.length > 1) {
      body.allocations = c.proposed.map((a) => ({ bid_id: a.bid_id, share_pct: Number(adjusted[a.bid_id] || 0) })).filter((a) => a.share_pct > 0);
    }
    onSave(body);
  };

  return (
    <div className="mt-12px padding-12px-14px border-1px-solid-ink-30">
      <div className="ep-k">Decision · needs tier {c.required_tier}</div>
      <div className="mt-8px fs-13px">
        <b>Officer recommends{c.kind === "exclude" ? " leaving this line out of the award" : ""}:</b>
        <div className="mt-3px">{c.kind !== "exclude" && <Allocations allocs={c.proposed} />}</div>
        {c.is_override && (
          <div className="mt-6px">
            <Tag text="Not the system's top-ranked bid" tone="att" /> System's L1/C1 is <b>{c.system_top_vendor || ""}</b>.
          </div>
        )}
        {c.officer_reason && (
          <div className="mt-6px pre-wrap">
            <span className="ep-sub">Officer's reason:</span> {c.officer_reason}
          </div>
        )}
      </div>
      <label className="ep-check items-start mt-8px">
        <input type="radio" checked={decision === "approve"} onChange={() => setDecision("approve")} />
        <span>{c.kind === "exclude" ? "Approve leaving the line out" : "Approve the Officer's recommendation"}</span>
      </label>
      {split && decision === "approve" && (
        <div className="margin-6px-0-0-26px fs-13px">
          {c.proposed.map((a) => (
            <div className="d-flex gap-10px items-center mt-4px" key={a.bid_id}>
              <span className="minw-230px">{a.vendor_name}</span>
              <input
                className="input w-90px"
                type="number"
                min={0}
                max={100}
                step={1}
                value={adjusted[a.bid_id] ?? ""}
                onChange={(e) => setAdjusted((s) => ({ ...s, [a.bid_id]: e.target.value }))}
              />{" "}
              <span className="ep-sub">%</span>
            </div>
          ))}
          <div className="ep-sub mt-4px">You can adjust the shares; they must total 100% (each at least {line.min_split_pct}%).</div>
        </div>
      )}
      {canSystem && (
        <label className="ep-check items-start mt-8px">
          <input type="radio" checked={decision === "award_system_l1"} onChange={() => setDecision("award_system_l1")} />
          <span>
            Award to the system's L1/C1 instead — <b>{c.system_top_vendor}</b>
          </span>
        </label>
      )}
      <label className="ep-check items-start mt-8px">
        <input type="radio" checked={decision === "reject"} onChange={() => setDecision("reject")} />
        <span>Reject — return to the Officer</span>
      </label>
      <div className="ep-field mt-10px">
        <div className="ep-k">
          {decision === "reject" ? "Comments" : "Comments (if any)"}
          {decision === "reject" && <Req />}
        </div>
        <textarea
          className={`input w-full${commentsInvalid ? " invalid" : ""}`}
          rows={2}
          value={comments}
          onChange={(e) => {
            setComments(e.target.value);
            setCommentsInvalid(false);
          }}
          onBlur={() => {
            if (decision === "reject" && !comments.trim()) setCommentsInvalid(true);
          }}
        />
        <FieldError errors={{ comments: commentsInvalid ? "A reason is mandatory to reject." : "" }} name="comments" />
      </div>
      {error && <div className="result err">{error}</div>}
      <div className="d-flex justify-end mt-8px">
        <button className="ep-b" data-v="p" disabled={saving} onClick={save}>
          Confirm decision
        </button>
      </div>
    </div>
  );
}
