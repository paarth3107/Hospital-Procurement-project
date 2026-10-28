import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { switchView } from "../../lib/bridge";
import { takeFlash } from "../../lib/flash";
import { fmtDateTime } from "../../lib/format";
import { applyVendorPortalStats } from "../../lib/chromeStore";
import { useAuthState } from "../../lib/authStore";
import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import { Tag, StateTag } from "../../components/Tag";
import { bidDisplayStatus } from "./VendorBidsPage";
import type { ItemRequirement, MyBid, PortalTender, Rating, RegisteredTender, VendorDetail, VendorDocument, VendorMapping } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorDashboardPage.js -- vendor portal
// home: status notes (what to do next: verification pending -> categories
// -> bidding) and the KPI strip. The full tender-invitations table, bids
// table and rating scorecards used to live here too; split out into their
// own sidebar tabs (2026-10-23, user-directed) -- VendorInvitationsPage.tsx/
// VendorBidsPage.tsx (originally one combined VendorTendersPage.tsx, itself
// split in two 2026-10-28, user-directed) and VendorRatingsPage.tsx --
// rather than keeping a second, less capable copy of the same tables here
// (the Dashboard's own version had no real filter, just a show/hide-closed
// checkbox). Tenders/bids/ratings are still fetched here, just for the KPI
// numbers, not rendered as full tables... except the latest 5 of each
// (2026-10-28, user-directed: "like we had before") --
// InvitationsPreview/BidsPreview below, compact, no filter/pagination of
// their own, each with a "View all" link to its own full tab.

// Latest 5 by id, descending -- both PortalTender/MyBid ids are assigned in
// creation order, the only real "recency" signal either type carries (no
// separate invited-at/created-at field exists on PortalTender).
function InvitationsPreview({ tenders }: { tenders: PortalTender[] }) {
  const latest = tenders.slice().sort((a, b) => b.tender_id - a.tender_id).slice(0, 5);
  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Latest Invitations</span>
        <button className="ep-b" onClick={() => switchView("vendor-invitations")}>
          View all
        </button>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Tender", "Type", "Bids Close", "Status", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!latest.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={5}>
                No invitations yet.
              </td>
            </tr>
          ) : (
            latest.map((t) => (
              <tr key={t.tender_id}>
                <td className="ep-cell">
                  <div className="fw-700">{t.title}</div>
                  <div className="ep-sub">{t.facility_name}</div>
                </td>
                <td className="ep-cell fs-12px">{t.tender_type}</td>
                <td className="ep-cell fs-12-5px">{t.bid_due_date ? fmtDateTime(t.bid_due_date) : "—"}</td>
                <td className="ep-cell">{t.can_bid ? <Tag text="Open" tone="pos" /> : <Tag text="Closed" tone="neg" />}</td>
                <td className="ep-cell text-right">
                  <button className="ep-b" data-v="p" onClick={() => switchView(`bid/${t.tender_id}`)}>
                    View
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function BidsPreview({ bids }: { bids: MyBid[] }) {
  const latest = bids.slice().sort((a, b) => b.id - a.id).slice(0, 5);
  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Latest Bids</span>
        <button className="ep-b" onClick={() => switchView("vendor-bids")}>
          View all
        </button>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Tender", "Line Item", "Qty", "Status", "Outcome"].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!latest.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={5}>
                No bids yet.
              </td>
            </tr>
          ) : (
            latest.map((b) => (
              <tr key={b.id}>
                <td className="ep-cell">{b.tender_title}</td>
                <td className="ep-cell">{b.product_name}</td>
                <td className="ep-cell">{b.qty}</td>
                <td className="ep-cell">
                  <StateTag state={bidDisplayStatus(b)} />
                </td>
                <td className="ep-cell fs-12-5px fw-600">{b.outcome ? b.outcome : <span className="ep-sub">{b.submitted_at ? "Awaiting result" : "—"}</span>}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// No separate "rejected" note (2026-10-24, user-directed) -- a rejected
// application now lands on "blacklisted" directly, same as an already-
// Active vendor gone bad.
const NOTES: Record<string, string> = {
  pending_verification: "Verification pending: your registration and documents are with our team for review. You'll be able to request categories once they're approved.",
  info_requested: "More information requested: check the note on your profile and re-upload any rejected documents under Company profile.",
  blacklisted: "Your registration was not approved, or this account has been blacklisted. See the note on your profile.",
  suspended: "Your account is suspended: you can't bid or be invited to new tenders until it's reinstated. See the note on your profile.",
};

function StatusNote({ vendor, registeredTender }: { vendor: VendorDetail; registeredTender: RegisteredTender | null }) {
  if (vendor.status === "active") return null;
  const why = ["suspended", "info_requested", "blacklisted"].includes(vendor.status) && vendor.rejection_reason ? ` Reason: ${vendor.rejection_reason}` : "";
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

export function VendorDashboardPage() {
  // Reads the vendor from the shared auth store instead of fetching
  // /vendor-auth/me itself (2026-10-28, user-reported: the network panel
  // still showed "me" fetched twice after the first duplicate-request fix)
  // -- AuthBoot.tsx already fetches it once on boot and keeps it here, same
  // fix already applied to TenderEditorPage.tsx's currentUser (2026-10-15:
  // "own redundant /auth/me fetch, same pattern as DashboardPage -- the
  // role is already in the shared auth store").
  const { vendor } = useAuthState();
  const [tenders, setTenders] = useState<PortalTender[]>([]);
  const [bids, setBids] = useState<MyBid[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [docs, setDocs] = useState<VendorDocument[]>([]);
  const [mappings, setMappings] = useState<VendorMapping[]>([]);
  const [requirements, setRequirements] = useState<ItemRequirement[]>([]);
  const [registeredTender, setRegisteredTender] = useState<RegisteredTender | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    if (!vendor) return; // not loaded into the auth store yet -- this effect re-runs once it is (vendor is a dep below)
    try {
      // Notifications fetched here too now (2026-10-28, user-reported: "too
      // many repeated requests") -- this page feeds the sidebar's chrome
      // badges directly (applyVendorPortalStats below) instead of letting
      // AppShell's own refreshChrome() effect fetch tenders/requirements a
      // second time for the exact same numbers (see chromeStore.ts's own
      // comment on applyVendorPortalStats).
      const [t, b, r, d, notes] = await Promise.all([
        api<PortalTender[]>("/vendor-portal/tenders"),
        api<MyBid[]>("/vendor-portal/bids"),
        api<Rating[]>("/vendor-portal/ratings"),
        api<VendorDocument[]>("/vendor-portal/documents"),
        api<{ read: boolean }[]>("/vendor-portal/notifications"),
      ]);
      setTenders(t);
      setBids(b);
      setRatings(r);
      setDocs(d);
      let reqs: ItemRequirement[] = [];
      if (vendor.status === "active") {
        const [m, rq] = await Promise.all([api<VendorMapping[]>("/vendor-portal/mappings"), api<ItemRequirement[]>("/vendor-portal/documents/requirements")]);
        setMappings(m);
        setRequirements(rq);
        reqs = rq;
      } else {
        // No mapped items exist yet for a not-yet-Active vendor, so there's
        // nothing "documents needed" could ever be flagging -- an empty
        // list here is the real answer, not a placeholder standing in for
        // a fetch this branch deliberately doesn't make.
        try {
          setRegisteredTender(await api<RegisteredTender | null>("/vendor-portal/registered-tender"));
        } catch {
          setRegisteredTender(null);
        }
      }
      applyVendorPortalStats({ requirements: reqs, notifications: notes, tenders: t });
      setError("");
      const f = takeFlash();
      if (f) setFlash(f);
    } catch (err) {
      setError("Could not load dashboard: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [vendor]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !vendor) return <div className="result err">{error}</div>;
  if (!vendor) return null;

  const openLinesCount = tenders.filter((t) => t.can_bid).flatMap((t) => t.line_items).length;
  const submittedCount = bids.filter((b) => b.status === "submitted").length;
  const awardedCount = bids.filter((b) => b.outcome && b.outcome.startsWith("Awarded")).length;
  // Real score now, not just a count of how many types happen to be rated
  // (2026-10-28, user-directed: "useless, make an avg rating and display
  // that instead") -- the tile used to show the actual score only for a
  // vendor rated on exactly one procurement type, and a meaningless raw
  // count ("3 type(s) rated") for anyone rated on more than one.
  const ratedScores = ratings.filter((r) => !r.is_unrated).map((r) => r.overall_score);
  const avgRating = ratedScores.length ? ratedScores.reduce((sum, s) => sum + s, 0) / ratedScores.length : null;
  const ratingValue = avgRating != null ? avgRating.toFixed(0) : ratings.length ? "NR" : "—";
  const ratingSub = avgRating != null ? `avg of ${ratedScores.length} type(s)` : "not yet rated";
  // Each tile links to the tab that actually shows the thing it's counting
  // (2026-10-28, user-directed: "Tenders" split into VendorInvitationsPage.
  // tsx/VendorBidsPage.tsx, route the view buttons to it). "Open
  // Invitations" counts tender lines, so it still goes to the Invitations
  // tab, pre-filtered via its own ?filter=open. "Bids Submitted" and
  // "Awarded" both count individual BID rows (bids.filter(...)), so both go
  // to the Bids tab now instead -- that table has no filter of its own,
  // but it's the table that actually shows what each of these is counting.
  const kpiCells: KpiCell[] = [
    ["Open Invitations", openLinesCount, "you can bid now", "vendor-invitations?filter=open", "file-text", "primary"],
    ["Bids Submitted", submittedCount, "prices sealed until deadline", "vendor-bids", "check-square", "info"],
    ["Awarded", awardedCount, "line(s) won", "vendor-bids", "award", "success"],
    ["My Rating", ratingValue, ratingSub, "vendor-ratings", "star", "warning"],
  ];

  return (
    <div className="d-flex flex-col gap-18px">
      <StatusNote vendor={vendor} registeredTender={registeredTender} />
      {vendor.status === "active" && <ActiveVendorNote mappings={mappings} requirements={requirements} />}
      <ExpiryNote docs={docs} />
      <KpiStrip cells={kpiCells} />
      <InvitationsPreview tenders={tenders} />
      <BidsPreview bids={bids} />
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
