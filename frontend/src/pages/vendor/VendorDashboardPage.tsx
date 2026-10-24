import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { switchView } from "../../lib/bridge";
import { takeFlash } from "../../lib/flash";
import { KpiStrip, type KpiCell } from "../../components/KpiStrip";
import type { ItemRequirement, MyBid, PortalTender, Rating, RegisteredTender, VendorDetail, VendorDocument, VendorMapping } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorDashboardPage.js -- vendor portal
// home: status notes (what to do next: verification pending -> categories
// -> bidding) and the KPI strip. The full tender-invitations table, bids
// table and rating scorecards used to live here too; split out into their
// own sidebar tabs (2026-10-23, user-directed) -- VendorTendersPage.tsx and
// VendorRatingsPage.tsx -- rather than keeping a second, less capable copy
// of the same tables here (the Dashboard's own version had no real filter,
// just a show/hide-closed checkbox). Tenders/bids/ratings are still
// fetched here, just for the KPI numbers, not rendered as full tables.

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
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
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

  const openLinesCount = tenders.filter((t) => t.can_bid).flatMap((t) => t.line_items).length;
  const submittedCount = bids.filter((b) => b.status === "submitted").length;
  const awardedCount = bids.filter((b) => b.outcome && b.outcome.startsWith("Awarded")).length;
  const ratingValue =
    ratings.length === 1 ? (ratings[0].is_unrated ? "NR" : ratings[0].overall_score.toFixed(0)) : ratings.length ? String(ratings.length) : "—";
  const ratingSub = ratings.length === 1 ? ratings[0].procurement_type : ratings.length ? "type(s) rated" : "not yet rated";
  // Each tile now links to the tab that actually shows the thing it's
  // counting -- VendorTendersPage.tsx's own filter picks up ?filter=... so
  // "Open Invitations"/"Bids Submitted"/"Awarded" land pre-filtered rather
  // than on an unfiltered "All" list the vendor has to re-filter themselves.
  const kpiCells: KpiCell[] = [
    ["Open Invitations", openLinesCount, "you can bid now", "vendor-tenders?filter=open", "file-text", "primary"],
    ["Bids Submitted", submittedCount, "prices sealed until deadline", "vendor-tenders?filter=submitted", "check-square", "info"],
    ["Awarded", awardedCount, "line(s) won", "vendor-tenders?filter=awarded", "award", "success"],
    ["My Rating", ratingValue, ratingSub, "vendor-ratings", "star", "warning"],
  ];

  return (
    <div className="d-flex flex-col gap-18px">
      <StatusNote vendor={vendor} registeredTender={registeredTender} />
      {vendor.status === "active" && <ActiveVendorNote mappings={mappings} requirements={requirements} />}
      <ExpiryNote docs={docs} />
      <KpiStrip cells={kpiCells} />
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
