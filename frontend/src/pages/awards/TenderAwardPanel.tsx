import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { refreshChrome } from "../../lib/chromeStore";
import { fmtDate, fmtDateTime, inr } from "../../lib/format";
import { Tag, StateTag } from "../../components/Tag";
import { Req } from "../../components/Req";
import { FieldError } from "../../components/FieldError";
import { useModal } from "../../components/useModal";
import type { AwardTender } from "../../lib/types";
import { AwardLineCard } from "./AwardLineCard";

const CLOSED_STATUSES = new Set(["awarded", "no_award"]);
// Today, local time, as "YYYY-MM-DD" -- matches a <input type="date">
// value and the ISO date string the backend's `date` columns use, without
// going through a UTC-shifting Date/toISOString round-trip that can land
// on the wrong day near midnight.
function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Required-together, end-after-start (2026-10-28, user-directed: "Rate
// Contract Start Date and End Date" needed the same on-blur-error pattern
// every other field in the app already has -- this used to only check at
// submit time, with no inline feedback). Start is pre-filled with today by
// the effect below, but the date picker lets it be cleared, so it still
// needs its own required check, not just "assume it's always set".
function checkContractStart(start: string): string | null {
  return start ? null : "Contract start date is required.";
}
function checkContractEnd(end: string, start: string): string | null {
  if (!end) return "Contract end date is required.";
  if (start && end <= start) return "Must be after the start date.";
  return null;
}

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
  // Rate Contract dates (2026-10-28, user-directed): entered right here,
  // at L1-submission time, instead of at tender-draft time -- Start
  // defaults to today (the closest real proxy for "date of awarding"
  // available before the Approving Authority actually decides), End is
  // always the Officer's to pick. Initialized once per tender (keyed off
  // tenderId, not every reload) so an unrelated line recommendation save
  // mid-edit doesn't stomp on what's been typed here but not submitted yet.
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const checkStart = (value: string) => {
    const err = checkContractStart(value);
    setFieldErrors((prev) => (prev.contract_start_date === (err ?? "") ? prev : { ...prev, contract_start_date: err ?? "" }));
  };
  const checkEnd = (value: string, start: string) => {
    const err = checkContractEnd(value, start);
    setFieldErrors((prev) => (prev.contract_end_date === (err ?? "") ? prev : { ...prev, contract_end_date: err ?? "" }));
  };

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
    setContractStart("");
    setContractEnd("");
    setFieldErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  useEffect(() => {
    if (!t?.is_rate_contract || CLOSED_STATUSES.has(t.status)) return;
    setContractStart((v) => v || t.contract_start_date || todayInputValue());
    setContractEnd((v) => v || t.contract_end_date || "");
  }, [t]);

  const onChanged = (message: string) => {
    setFlash(message);
    load();
    // A recommendation/decision save changes badgeAwards -- found
    // 2026-10-15, alongside removing AppShell's blanket per-navigation
    // chrome refresh: that used to paper over this page never telling
    // chromeStore an action happened at all.
    refreshChrome();
  };

  const submit = async () => {
    if (t?.is_rate_contract) {
      const startErr = checkContractStart(contractStart);
      const endErr = checkContractEnd(contractEnd, contractStart);
      if (startErr || endErr) {
        setFieldErrors({ contract_start_date: startErr ?? "", contract_end_date: endErr ?? "" });
        (startErr ? startRef : endRef).current?.focus();
        return;
      }
    }
    const ok = await confirmAsync("Submit every line's recommendation to the Approving Authority for L1 approval?", { title: "Submit For L1 Approval", confirmLabel: "Submit" });
    if (!ok) return;
    setSubmitting(true);
    setError("");
    try {
      await api(`/awards/tenders/${tenderId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t?.is_rate_contract ? { contract_start_date: contractStart, contract_end_date: contractEnd } : {}),
      });
      setFlash("Submitted for L1 approval.");
      load();
      refreshChrome();
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

      {t.is_rate_contract && (
        <div className="ep-pane ep-pane-pad">
          <div className="ep-k">Rate Contract Period</div>
          {CLOSED_STATUSES.has(t.status) ? (
            <div className="mt-6px fs-13-5px">
              {t.contract_start_date ? fmtDate(t.contract_start_date) : "—"} – {t.contract_end_date ? fmtDate(t.contract_end_date) : "—"}
            </div>
          ) : (
            <>
              <div className="d-flex gap-10px mt-8px">
                <div>
                  <div className="ep-k">
                    Start Date <Req />
                  </div>
                  <input
                    ref={startRef}
                    className={`input input-narrow-date${fieldErrors.contract_start_date ? " invalid" : ""}`}
                    type="date"
                    value={contractStart}
                    onChange={(e) => {
                      setContractStart(e.target.value);
                      if (fieldErrors.contract_start_date) checkStart(e.target.value);
                      if (fieldErrors.contract_end_date) checkEnd(contractEnd, e.target.value);
                    }}
                    onBlur={(e) => checkStart(e.target.value)}
                  />
                  <FieldError errors={fieldErrors} name="contract_start_date" />
                </div>
                <div>
                  <div className="ep-k">
                    End Date <Req />
                  </div>
                  <input
                    ref={endRef}
                    className={`input input-narrow-date${fieldErrors.contract_end_date ? " invalid" : ""}`}
                    type="date"
                    value={contractEnd}
                    onChange={(e) => {
                      setContractEnd(e.target.value);
                      if (fieldErrors.contract_end_date) checkEnd(e.target.value, contractStart);
                    }}
                    onBlur={(e) => checkEnd(e.target.value, contractStart)}
                  />
                  <FieldError errors={fieldErrors} name="contract_end_date" />
                </div>
              </div>
              <div className="hint mt-6px">Start date defaults to today and end date is yours to set -- both stay editable right up until this tender is submitted for L1 approval.</div>
            </>
          )}
        </div>
      )}

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
