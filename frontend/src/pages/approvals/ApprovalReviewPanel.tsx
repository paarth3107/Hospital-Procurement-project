import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, API_BASE, apiHeaders } from "../../lib/api";
import { fmtDate, fmtDateTime, inr } from "../../lib/format";
import { Tag, TypeTag } from "../../components/Tag";
import { useModal } from "../../components/useModal";
import { canPreviewInApp } from "../../components/DocumentPreviewModal";
import type { ReviewLine, ReviewVendor, Tender, TenderReview } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/approvals/reviewPanel.js -- the
// approver's review of one tender, before publishing it (spec 7.2): header
// terms, line items by procurement type, the vendors each line would go to,
// warnings, the approval history, and the decision. Everything comes from
// GET /tenders/{id}/approval-review.
function Pane({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>{title}</span>
        {right}
      </div>
      <div className="padding-14px-16px">{children}</div>
    </div>
  );
}

function Fact({ k, v, span = 1 }: { k: string; v: ReactNode; span?: number }) {
  return (
    <div className={`col-span-${span}`}>
      <div className="ep-k">{k}</div>
      <div className="fw-600 mt-3px fs-13px break-word">{v == null || v === "" ? "—" : v}</div>
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <div className="d-grid grid-cols-repeat41fr gap-14px-18px">{children}</div>;
}

// A dict of extra, free-form facts (line_details/catalog_attrs) -- shown as
// plain "key: value" sub-lines, same as the vendor mapping dialog's own kv().
function Kv({ obj }: { obj: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(obj || {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  if (!entries.length) return null;
  return (
    <>
      {entries.map(([k, v]) => (
        <div className="ep-sub" key={k}>
          {k.replace(/_/g, " ")}: <b>{Array.isArray(v) ? v.join(", ") : v === true ? "yes" : v === false ? "no" : String(v)}</b>
        </div>
      ))}
    </>
  );
}

// Small pill badges next to the title for whichever flags apply -- no
// explanatory paragraph, same spirit as the status tags used everywhere else.
function FlagTags({ r }: { r: TenderReview }) {
  return (
    <>
      {r.open_tender && <Tag text="Open tender" tone="att" />}
      {r.is_rate_contract && <Tag text="Rate contract" tone="att" />}
    </>
  );
}

function evalMethodLabel(l: ReviewLine): string {
  if (l.technical_eval_method === "qualify_disqualify") return "Qualify / disqualify, then lowest price (L1)";
  if (l.technical_eval_method === "scored") return "Scored technical ranking, then lowest price (L1)";
  return `QCBS — technical ${l.technical_weight ?? "?"} / price ${l.price_weight ?? "?"}`;
}

function vendorBasis(v: ReviewVendor): string {
  // ReviewVendorOut carries no source/reason (unlike the eligibility-preview
  // endpoint's EligibleVendorOut) -- ported faithfully from vanilla's own
  // basis(), which always falls through to "Eligibility rules" here, same
  // as the page actually behaves today.
  const withSource = v as ReviewVendor & { source?: string; reason?: string };
  if (withSource.source === "guest") return `Guest: ${withSource.reason || ""}`;
  if (withSource.source === "open") return "Open tender";
  return "Eligibility rules";
}

function LineCard({ l }: { l: ReviewLine }) {
  return (
    <div className="padding-12px-0 border-top-1px-solid-ink-20">
      <div className="d-flex gap-10px items-center flex-wrap">
        <span className="fs-16px fw-800">{l.product_name}</span>
        <span className="ep-sub">
          {l.product_code} · {l.category}
        </span>
        <TypeTag type={l.procurement_type} />
        {l.split_award_allowed && <Tag text="Split award allowed" tone="esc" />}
      </div>
      <Facts>
        <Fact k="Quantity" v={`${l.qty}${l.uom ? " " + l.uom : ""}`} />
        <Fact k="Estimated price / unit" v={l.estimated_price != null ? inr(l.estimated_price) : "not set"} />
        <Fact k="Line value" v={l.line_value != null ? inr(l.line_value) : "—"} />
        <Fact k="Minimum vendor rating" v={l.min_rating_applied} />
        <Fact k="Evaluation" v={evalMethodLabel(l)} span={2} />
        <Fact k="Regulatory class" v={l.regulatory_class || ""} />
        <Fact k="Required vendor documents" v={l.required_documents.length ? l.required_documents.join(", ") : "none"} />
      </Facts>
      {(Object.keys(l.line_details || {}).length > 0 || Object.keys(l.catalog_attrs || {}).length > 0) && (
        <div className="mt-8px">
          <div className="ep-k">Specification &amp; terms</div>
          <Kv obj={l.line_details} />
          <Kv obj={l.catalog_attrs} />
        </div>
      )}
      <div className="mt-10px">
        <div className="ep-k">Vendors this line would be published to ({l.eligible_vendors.length})</div>
        {l.eligible_vendors.length ? (
          <table className="ep-table mt-6px">
            <thead>
              <tr>
                <th className="ep-th">Vendor</th>
                <th className="ep-th">Rating</th>
                <th className="ep-th">Why invited</th>
              </tr>
            </thead>
            <tbody>
              {l.eligible_vendors.map((v) => (
                <tr key={v.vendor_id}>
                  <td className="ep-cell">{v.legal_name}</td>
                  <td className="ep-cell">{v.rating_score}</td>
                  <td className="ep-cell">{vendorBasis(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ep-note warn mt-6px">No eligible vendor: this line would be held back and not published.</div>
        )}
      </div>
    </div>
  );
}

export function ApprovalReviewPanel({ tenderId, onBack, onDecided }: { tenderId: number; onBack: () => void; onDecided: (message: string) => void }) {
  const [review, setReview] = useState<TenderReview | null>(null);
  const [error, setError] = useState("");
  const [comments, setComments] = useState("");
  const [commentsInvalid, setCommentsInvalid] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const { openPreview, modalElement } = useModal();

  useEffect(() => {
    api<TenderReview>(`/tenders/${tenderId}/approval-review`)
      .then(setReview)
      .catch((err) => setError("Could not load the review: " + (err instanceof Error ? err.message : String(err))));
  }, [tenderId]);

  const view = async (endpoint: string, filename: string) => {
    try {
      const res = await fetch(`${API_BASE}/tenders/${tenderId}/${endpoint}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (canPreviewInApp(blob.type)) openPreview({ url, filename, contentType: blob.type }, () => URL.revokeObjectURL(url));
      else window.open(url, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const decide = async (action: "approve" | "reject") => {
    const trimmed = comments.trim();
    if (action === "reject" && !trimmed) {
      setCommentsInvalid(true);
      return;
    }
    setDeciding(true);
    try {
      const updated = await api<Tender>(`/tenders/${tenderId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: trimmed || null }),
      });
      const approvedMessage =
        updated.status === "scheduled"
          ? `Tender #${tenderId} approved — scheduled to publish ${fmtDateTime(updated.publish_date)}.`
          : `Tender #${tenderId} approved and published.`;
      onDecided(action === "approve" ? approvedMessage : `Tender #${tenderId} rejected and returned to draft.`);
    } catch (err) {
      setError(`Could not ${action} the tender: ` + (err instanceof Error ? err.message : String(err)));
      setDeciding(false);
    }
  };

  if (error && !review) return <div className="result err">{error}</div>;
  if (!review) return null;
  const r = review;

  return (
    <div className="d-flex flex-col gap-18px">
      <div>
        <button className="ep-b" onClick={onBack}>
          ← Approval inbox
        </button>
      </div>
      <div className="ep-pane ep-pane-pad d-flex gap-24px items-center flex-wrap">
        <div className="flex-1 minw-260px">
          <div className="ep-k">
            Tender #{r.id} · {r.tender_type.toUpperCase().replace("_", " ")} · round {r.round_number}
          </div>
          <h4 className="margin-4px-0-3px fs-22px">
            {r.title} <FlagTags r={r} />
          </h4>
          <div className="ep-sub">
            {r.facility_name}
            {r.department ? ` · ${r.department}` : ""}
          </div>
        </div>
        <div>
          <div className="ep-k">Total estimated value</div>
          <div className="fs-22px fw-800 mt-3px">{inr(r.total_estimated_value)}</div>
        </div>
        <div>
          <div className="ep-k">Approval required from</div>
          <div className="mt-5px">
            <Tag text={r.required_tier ? "Tier " + r.required_tier : "—"} tone="att" />
          </div>
          <div className="ep-sub">{r.tier_label || ""}</div>
        </div>
        {r.is_rate_contract && (
          <div>
            <div className="ep-k">Rate contract period</div>
            <div className="fw-700 mt-3px">
              {fmtDate(r.contract_start_date)} – {fmtDate(r.contract_end_date)}
            </div>
          </div>
        )}
      </div>

      {r.warnings.map((w, i) => (
        <div className="ep-note warn" key={i}>
          {w}
        </div>
      ))}

      <Pane title="Tender Details">
        <Facts>
          <Fact k="Type" v={r.tender_type.replace("_", " ")} />
          <Fact k="Facility / entity" v={r.facility_name + (r.facility_code ? ` (${r.facility_code})` : "")} />
          <Fact k="Department" v={r.department || ""} />
          <Fact k="Prepared by" v={r.created_by || ""} />
          <Fact k="Publish date" v={r.publish_date ? fmtDateTime(r.publish_date) : "On approval"} />
          <Fact k="Bids close" v={fmtDateTime(r.bid_due_date)} />
          <Fact k="Default minimum vendor rating" v={r.min_rating_threshold} />
          <Fact k="Vendors per line (min / max)" v={`${r.min_invites ?? "—"} / ${r.max_invites ?? "—"}`} />
          {r.description && <Fact k="Description" v={<span className="pre-wrap fw-400">{r.description}</span>} span={4} />}
          <Fact
            k="Terms & conditions"
            span={4}
            v={
              r.terms_document_filename ? (
                <button type="button" className="ep-b" onClick={() => view("terms-document", r.terms_document_filename!)}>
                  {r.terms_document_filename} — view
                </button>
              ) : null
            }
          />
          {r.is_rate_contract && (
            <Fact
              k="Rate contract agreement"
              span={4}
              v={
                r.rate_contract_document_filename ? (
                  <button type="button" className="ep-b" onClick={() => view("rate-contract-document", r.rate_contract_document_filename!)}>
                    {r.rate_contract_document_filename} — view
                  </button>
                ) : null
              }
            />
          )}
        </Facts>
      </Pane>

      <Pane title={`Line Items (${r.lines.length})`} right={<span className="ep-k">{r.lines.filter((l) => l.held_back).length} would be held back</span>}>
        {r.lines.map((l) => (
          <LineCard l={l} key={l.line_item_id} />
        ))}
      </Pane>

      <Pane title="Approval History">
        {r.rounds.length ? (
          <table className="ep-table">
            <thead>
              <tr>
                <th className="ep-th">Round</th>
                <th className="ep-th">Required tier</th>
                <th className="ep-th">Submitted by</th>
                <th className="ep-th">Decision</th>
                <th className="ep-th">Reviewer / comments</th>
              </tr>
            </thead>
            <tbody>
              {r.rounds.map((x) => (
                <tr key={x.round_number}>
                  <td className="ep-cell">{x.round_number}</td>
                  <td className="ep-cell">Tier {x.required_tier}</td>
                  <td className="ep-cell fs-12-5px">
                    {x.submitted_by || "—"}
                    <div className="ep-sub">{fmtDateTime(x.submitted_at)}</div>
                  </td>
                  <td className="ep-cell">
                    <Tag text={x.decision} tone={x.decision === "approved" ? "pos" : x.decision === "rejected" ? "neg" : "att"} />
                  </td>
                  <td className="ep-cell fs-12-5px">
                    {x.reviewer || "—"}
                    {x.decided_at && <div className="ep-sub">{fmtDateTime(x.decided_at)}</div>}
                    {x.comments && <div>{x.comments}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ep-sub">No rounds yet.</div>
        )}
      </Pane>

      <div className="ep-pane ep-pane-pad">
        {r.can_decide ? (
          <>
            <div className="ep-field">
              <div className="ep-k">Comments (required to reject)</div>
              <textarea
                className={`input w-full${commentsInvalid ? " invalid" : ""}`}
                rows={3}
                value={comments}
                onChange={(e) => {
                  setComments(e.target.value);
                  setCommentsInvalid(false);
                }}
              />
              {commentsInvalid && <div className="hint mt-4px text-danger-700">A reason is mandatory to reject a tender.</div>}
            </div>
            <div className="d-flex gap-10px justify-end mt-12px">
              <button className="ep-b" disabled={deciding} onClick={() => decide("reject")}>
                Reject — return to draft
              </button>
              <button className="ep-b" data-v="p" disabled={deciding} onClick={() => decide("approve")}>
                Approve &amp; publish
              </button>
            </div>
          </>
        ) : (
          <div className="hint">
            {r.status === "pending_approval" ? `You can't decide this tender: it needs an Approving Authority at tier ${r.required_tier} or above.` : `This tender is ${r.status.replace("_", " ")}; no decision is pending.`}
          </div>
        )}
      </div>
      {error && <div className="result err">{error}</div>}
      {modalElement}
    </div>
  );
}
