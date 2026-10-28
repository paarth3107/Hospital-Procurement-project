import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";

// Ported from frontend/js/pages/register/openLinkBanner.js, but fetched by
// each page itself (own useEffect) rather than shared via a vanilla
// showOpenLinkBanner() call -- that function mutates DOM by class selector
// right after switchView(), which is synchronous in vanilla but would race
// against this page's own async React mount if called from there instead.
// Every other ported page already fetches its own data on mount rather
// than depending on a vanilla-side fetch+DOM-write; this is the same thing.
// Shown on both the vendor login screen and the registration screen
// (2026-10-07: login comes first now). Renamed from OpenLinkNote
// (2026-10-28, user-directed, alongside the rest of the Guest Invite
// rename): sessionStorage key, API path and query param all moved from
// open*/openLink* to guest*/guestInvite*.
const LEAD: Record<string, string> = {
  unpublished: "is not published yet. You'll see it listed once it's published.",
  open: "is open for bids. You'll see it listed as soon as your registration is approved, and you can bid while bidding is open.",
  closed: "has closed for bidding, so registering through this link can't be completed.",
};

interface GuestInviteInfo {
  title: string;
  facility_name: string | null;
  department: string | null;
  bid_due_date: string | null;
  state: "unpublished" | "open" | "closed";
}

export function GuestInviteNote() {
  const token = sessionStorage.getItem("guestInviteToken");
  const [info, setInfo] = useState<GuestInviteInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setInfo(await api<GuestInviteInfo>(`/guest-invite-links/${token}`));
      } catch (err) {
        sessionStorage.removeItem("guestInviteToken");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [token]);

  if (!token) return null;
  if (error) return <div className="ep-note warn"><span>{error}</span></div>;
  if (!info) return null;
  const place = [info.facility_name, info.department].filter(Boolean).join(" · ");
  const due = info.bid_due_date ? ` · bids close ${fmtDateTime(info.bid_due_date)}` : "";
  return (
    <div className="ep-note">
      <span>
        <b>{info.title}</b>
        {place ? ` · ${place}` : ""}
        {due}
        <br />
        This tender {LEAD[info.state]}
      </span>
    </div>
  );
}
