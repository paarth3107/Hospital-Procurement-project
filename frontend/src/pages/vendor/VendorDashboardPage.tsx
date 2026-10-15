import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime, inr } from "../../lib/format";
import { switchView, setPendingBidTenderId } from "../../lib/bridge";
import { takeFlash } from "../../lib/flash";
import { Tag, StateTag } from "../../components/Tag";
import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { Pagination, pageSlice } from "../../components/Pagination";
import { Scorecard } from "../ratings/Scorecard";
import type { ItemRequirement, MyBid, PortalTender, Rating, RegisteredTender, VendorDetail, VendorDocument, VendorMapping } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorDashboardPage.js -- vendor portal
// home: tenders the vendor is invited to (grouped one row per tender, not
// per line item -- a real tender can carry hundreds), and the vendor's
// submitted bids. A status note at the top says what to do next
// (verification pending -> categories -> bidding).
//
// Tenders in one of these statuses are done -- nothing left to act on. Kept
// out of "Open Invitations" by default (they pile up forever otherwise); a
// checkbox reveals them again without a refetch.
const CLOSED_TENDER_STATUSES = new Set(["awarded", "no_award"]);

const NOTES: Record<string, string> = {
  pending_verification: "Verification pending: your registration and documents are with our team for review. You'll be able to request categories once they're approved.",
  info_requested: "More information requested: check the note on your profile and re-upload any rejected documents under Company profile.",
  rejected: "Your registration was not approved. See the note on your profile.",
  suspended: "Your account is suspended: you can't bid or be invited to new tenders until it's reinstated. See the note on your profile.",
};

// Real bug, found 2026-10-14: the Status column always showed the bid
// DOCUMENT's own lifecycle status (draft/submitted/withdrawn -- it was
// submitted and never withdrawn, which stays true forever), while the
// separate Outcome column showed the award result once known -- so an
// awarded bid displayed "Submitted" right next to "Awarded", reading as a
// contradiction even though both fields were individually correct. Once
// outcome is known, show it as the Status tag too (StateTag already has
// awarded/no_award/disqualified tones); Outcome keeps the fuller text
// (exact split-award quantity, etc.).
function bidDisplayStatus(b: MyBid): string {
  if (b.outcome?.startsWith("Awarded")) return "awarded";
  if (b.outcome === "Not selected") return "no_award";
  if (b.outcome === "Technically disqualified") return "disqualified";
  return b.status;
}

function timeRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closed";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h` : `${h}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

interface TenderGroup {
  t: PortalTender;
  lines: PortalTender["line_items"];
}

function groupByTender(tenders: PortalTender[]): TenderGroup[] {
  return tenders.map((t) => ({ t, lines: t.line_items }));
}

function StatusNote({ vendor, registeredTender }: { vendor: VendorDetail; registeredTender: RegisteredTender | null }) {
  if (vendor.status === "active") return null;
  const why = ["suspended", "info_requested", "rejected"].includes(vendor.status) && vendor.rejection_reason ? ` Reason: ${vendor.rejection_reason}` : "";
  const lead = registeredTender
    ? { unpublished: "is not published yet. It will be listed here once it's published.", open: "is listed for you. You can bid on it once your registration is approved.", closed: "has closed for bidding." }[
        registeredTender.state
      ]
    : null;
  return (
    <>
      <div className="ep-note">
        <span>{(NOTES[vendor.status] || "Your registration is not active yet.") + why}</span>
        {["info_requested", "suspended"].includes(vendor.status) && (
          <button className="ep-b" onClick={() => switchView("vendor-profile")}>
            Open profile
          </button>
        )}
      </div>
      {registeredTender && (
        <div className="ep-note">
          <span>
            <b>{registeredTender.title}</b>, the open tender you registered for, {lead}
          </span>
        </div>
      )}
    </>
  );
}

function ActiveVendorNote({ mappings, requirements }: { mappings: VendorMapping[]; requirements: ItemRequirement[] }) {
  const owed = requirements.filter((r) => r.summary === "documents_needed");
  const counts = { approved: 0, pending: 0, rejected: 0, suspended: 0 } as Record<string, number>;
  for (const m of mappings) counts[m.state] = (counts[m.state] ?? 0) + 1;
  // A Rejected request is requestable again in Category Declaration, same as
  // one never requested at all -- it's not a dead end needing a nudge here.
  // Suspended still needs a nudge: only staff can reinstate it.
  const message = !mappings.length
    ? "Your documents are approved! Pick which categories (or individual items) you can supply to become eligible for tenders."
    : counts.suspended
    ? `${counts.suspended} request(s) suspended — see Category Declaration.`
    : null;
  return (
    <>
      {owed.length > 0 && (
        <div className="ep-note warn">
          <span>
            New documents are required for {owed.length} of your items ({owed.slice(0, 3).map((r) => r.product_name).join(", ")}
            {owed.length > 3 ? "…" : ""}). Upload them in Category Declaration; you can bid on those items once they are verified.
          </span>
          <button className="ep-b" data-v="p" onClick={() => switchView("vendor-categories")}>
            Upload documents
          </button>
        </div>
      )}
      {message && (
        <div className="ep-note">
          <span>{message}</span>
          <button className="ep-b" onClick={() => switchView("vendor-categories")}>
            Go to Category Declaration
          </button>
        </div>
      )}
    </>
  );
}

// An expired document silently suspends bidding the next time the expiry
// sweep runs -- surfaced here instead of only discoverable by trying to bid.
function ExpiryNote({ docs }: { docs: VendorDocument[] }) {
  const issues = docs.filter((d) => d.expiry_state === "expiring" || d.expiry_state === "expired");
  if (!issues.length) return null;
  const expired = issues.filter((d) => d.expiry_state === "expired");
  const label = (d: VendorDocument) => d.custom_label || d.doc_type.replace(/_/g, " ");
  const names = issues.slice(0, 3).map(label).join(", ") + (issues.length > 3 ? "…" : "");
  const text = expired.length
    ? `${expired.length} document(s) have expired (${names}). This can suspend your account until they're renewed.`
    : `${issues.length} document(s) are expiring soon (${names}). Renew them before they lapse.`;
  return (
    <div className="ep-note warn">
      <span>{text}</span>
      <button className="ep-b" data-v="p" onClick={() => switchView("vendor-profile")}>
        Open Company profile
      </button>
    </div>
  );
}

function TenderRow({ group }: { group: TenderGroup }) {
  const { t, lines } = group;
  const closed = CLOSED_TENDER_STATUSES.has(t.status);
  const submitted = lines.filter((li) => li.bid_status === "submitted").length;
  const statusTag = closed ? (
    <Tag text={t.status === "awarded" ? "Tender awarded" : "Closed, no award"} tone="neg" />
  ) : !t.can_bid ? (
    <Tag text="Deadline passed" tone="neg" />
  ) : submitted === lines.length ? (
    <Tag text="All submitted" tone="pos" />
  ) : submitted > 0 ? (
    <Tag text={`${submitted} of ${lines.length} submitted`} tone="att" />
  ) : (
    <Tag text="Not started" tone="att" />
  );
  return (
    <tr>
      <td className="ep-cell">
        <div className="fw-700">{t.title}</div>
        <div className="ep-sub">
          #{t.tender_id} · {t.facility_name}
        </div>
      </td>
      <td className="ep-cell fs-12px">{t.tender_type}</td>
      <td className="ep-cell fs-12-5px">{lines.length}</td>
      <td className="ep-cell fs-12-5px">
        {t.bid_due_date ? (
          <>
            <div className="fw-600">{t.can_bid ? timeRemaining(t.bid_due_date) : "closed"}</div>
            <div className="ep-sub">{fmtDateTime(t.bid_due_date)}</div>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="ep-cell">{statusTag}</td>
      <td className="ep-cell text-right nowrap">
        {(t.can_bid || submitted > 0) && (
          <button
            className="ep-b"
            data-v="p"
            onClick={() => {
              setPendingBidTenderId(t.tender_id);
              switchView("bid");
            }}
          >
            {submitted > 0 ? "View Bid" : "Prepare Bid"}
          </button>
        )}
      </td>
    </tr>
  );
}

export function VendorDashboardPage() {
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [tenders, setTenders] = useState<PortalTender[]>([]);
  const [bids, setBids] = useState<MyBid[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [docs, setDocs] = useState<VendorDocument[]>([]);
  const [mappings, setMappings] = useState<VendorMapping[]>([]);
  const [requirements, setRequirements] = useState<ItemRequirement[]>([]);
  const [registeredTender, setRegisteredTender] = useState<RegisteredTender | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [invitesPage, setInvitesPage] = useState(0);
  const [bidsPage, setBidsPage] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    try {
      const v = await api<VendorDetail>("/vendor-auth/me");
      setVendor(v);
      const [t, b, r, d] = await Promise.all([
        api<PortalTender[]>("/vendor-portal/tenders"),
        api<MyBid[]>("/vendor-portal/bids"),
        api<Rating[]>("/vendor-portal/ratings"),
        api<VendorDocument[]>("/vendor-portal/documents"),
      ]);
      setTenders(t);
      setBids(b);
      setRatings(r);
      setDocs(d);
      if (v.status === "active") {
        const [m, reqs] = await Promise.all([api<VendorMapping[]>("/vendor-portal/mappings"), api<ItemRequirement[]>("/vendor-portal/documents/requirements")]);
        setMappings(m);
        setRequirements(reqs);
      } else {
        try {
          setRegisteredTender(await api<RegisteredTender | null>("/vendor-portal/registered-tender"));
        } catch {
          setRegisteredTender(null);
        }
      }
      setError("");
      const f = takeFlash();
      if (f) setFlash(f);
    } catch (err) {
      setError("Could not load dashboard: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !vendor) return <div className="result err">{error}</div>;
  if (!vendor) return null;

  const allGroups = groupByTender(tenders);
  // Line-item count, not tender count -- matches vanilla's own closedCount
  // exactly (computed from the flattened per-line rows before grouping).
  const closedCount = tenders.filter((t) => CLOSED_TENDER_STATUSES.has(t.status)).flatMap((t) => t.line_items).length;
  // Soonest-closing first -- lines with no due date (shouldn't happen for a
  // published line, but be defensive) sort last rather than first.
  const byDeadline = (a: TenderGroup, b: TenderGroup) => new Date(a.t.bid_due_date || 8640000000000000).getTime() - new Date(b.t.bid_due_date || 8640000000000000).getTime();
  const groups = (showClosed ? allGroups : allGroups.filter((g) => !CLOSED_TENDER_STATUSES.has(g.t.status))).slice().sort(byDeadline);
  const openLinesCount = groups
    .filter((g) => g.t.can_bid)
    .flatMap((g) => g.lines).length;

  const submittedCount = bids.filter((b) => b.status === "submitted").length;
  const awardedCount = bids.filter((b) => b.outcome && b.outcome.startsWith("Awarded")).length;
  const ratingValue = ratings.length === 1 ? ratings[0].overall_score.toFixed(0) : ratings.length ? String(ratings.length) : "—";
  const ratingSub = ratings.length === 1 ? ratings[0].procurement_type : ratings.length ? "type(s) rated" : "not yet rated";
  const kpiCells: KpiCell[] = [
    ["Open Invitations", openLinesCount, "you can bid now", null, "file-text", "primary"],
    ["Bids Submitted", submittedCount, "prices sealed until deadline", null, "check-square", "info"],
    ["Awarded", awardedCount, "line(s) won", null, "award", "success"],
    ["My Rating", ratingValue, ratingSub, null, "star", "warning"],
  ];

  const { pageItems: tenderPageItems, totalPages: invitesTotalPages, page: invitesClamped } = pageSlice(groups, invitesPage);
  const { pageItems: bidPageItems, totalPages: bidsTotalPages, page: bidsClamped } = pageSlice(bids, bidsPage);

  return (
    <div className="d-flex flex-col gap-18px">
      <StatusNote vendor={vendor} registeredTender={registeredTender} />
      {vendor.status === "active" && <ActiveVendorNote mappings={mappings} requirements={requirements} />}
      <ExpiryNote docs={docs} />
      <KpiStrip cells={kpiCells} />

      <div className="ep-pane">
        <div className="ep-pane-head">
          <span>Open Invitations</span>
          <div className="d-flex items-center gap-14px">
            <label className="d-flex items-center gap-6px fs-12px fw-400 tt-none ls-0 text-ink-70">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => {
                  setShowClosed(e.target.checked);
                  setInvitesPage(0);
                }}
              />{" "}
              Show closed/awarded ({closedCount})
            </label>
            <span className="ep-k">{openLinesCount} biddable</span>
          </div>
        </div>
        <table className="ep-table">
          <thead>
            <tr>
              {["Tender", "Type", "Line Items", "Time Remaining", "Status", ""].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!tenderPageItems.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={6}>
                  {showClosed ? "No tenders you're invited to." : "No open tenders you're currently invited to."}
                </td>
              </tr>
            ) : (
              tenderPageItems.map((g) => <TenderRow group={g} key={g.t.tender_id} />)
            )}
          </tbody>
        </table>
        <Pagination page={invitesClamped} totalPages={invitesTotalPages} onChange={setInvitesPage} />
      </div>

      <div className="ep-pane">
        <div className="ep-pane-head">
          <span>Your Bids</span>
          <span className="ep-k">sealed until the deadline</span>
        </div>
        <table className="ep-table">
          <thead>
            <tr>
              {["Tender", "Line Item", "Qty", "Your Unit Price", "Status", "Outcome"].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!bidPageItems.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={6}>
                  No bids yet.
                </td>
              </tr>
            ) : (
              bidPageItems.map((b) => (
                <tr key={b.id}>
                  <td className="ep-cell">{b.tender_title}</td>
                  <td className="ep-cell">{b.product_name}</td>
                  <td className="ep-cell">{b.qty}</td>
                  <td className="ep-cell fw-700">{b.unit_price == null ? "—" : inr(b.unit_price)}</td>
                  <td className="ep-cell">
                    <StateTag state={bidDisplayStatus(b)} />
                  </td>
                  <td className="ep-cell fs-12-5px fw-600">{b.outcome ? b.outcome : <span className="ep-sub">{b.submitted_at ? "Awaiting result" : "—"}</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={bidsClamped} totalPages={bidsTotalPages} onChange={setBidsPage} />
      </div>

      {/* Rating visibility: reuses the staff scorecard component as-is, read-only. */}
      {!ratings.length ? (
        <div className="ep-pane ep-pane-pad">
          <div className="ep-k">Your Rating</div>
          <div className="hint mt-8px">You haven't been rated yet — this starts once you're approved for a category and begin supplying under it.</div>
        </div>
      ) : (
        <div className="ep-pane">
          <div className="ep-pane-head">
            <span>Your Rating</span>
            <span className="ep-k">one score per procurement type you're rated in</span>
          </div>
          <div className="padding-16px d-grid grid-cols-repeatauto-fitminmax260px1fr gap-14px">
            {ratings.map((r) => (
              <Scorecard vendor={vendor} rating={r} type={r.procurement_type} canAdjust={false} onAdjust={() => {}} key={r.id} />
            ))}
          </div>
        </div>
      )}
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
