import { fmtDate } from "../lib/format";

// Ported from frontend/js/kit.js's tag()/stateTag(). Same .ep-tag CSS,
// same data-t tone attribute values -- shared by every future page, not
// just Staff Accounts.
export type Tone = "" | "pos" | "att" | "neg" | "esc" | "item" | "asset" | "service";

export function Tag({ text, tone = "" }: { text: string; tone?: Tone }) {
  return <span className="ep-tag" data-t={tone || undefined}>{text}</span>;
}

const STATE_TONE: Record<string, Tone> = {
  active: "pos", approved: "pos", verified: "pos", published: "pos", accepted: "pos", awarded: "pos",
  pending: "", pending_verification: "", draft: "", submitted: "",
  pending_approval: "att", scheduled: "att", pending_late_exception: "att", info_requested: "esc", escalated: "esc",
  rejected: "neg", suspended: "neg", blacklisted: "neg", withdrawn: "neg", expired: "neg", disqualified: "neg", no_award: "neg",
};

export function StateTag({ state }: { state: string | null | undefined }) {
  const s = state || "—";
  return <Tag text={s.replace(/_/g, " ")} tone={STATE_TONE[s] ?? ""} />;
}

// Item/Asset/Service pill (ported from kit.js's typeTag()) -- each type is
// its own tone (data-t="item"/"asset"/"service"), not routed through
// STATE_TONE.
export function TypeTag({ type }: { type: string }) {
  return <Tag text={type} tone={(type as Tone) || ""} />;
}

// How a vendor got onto a line's invite list -- shared by the E-Tender
// Approval review and the L1 Award screen (2026-10-28, user-directed).
// "system" (the eligibility rules) and "open" (Open Tender's blanket
// Active-vendor invite) both read as "Eligible": neither singles anyone
// out, they're just two different ways the system decided who's in.
// "manual" (an officer's §6.6 manual add) reads as "Invited", with its
// reason shown underneath. "guest" (a brand-new vendor who registered
// through this tender's Guest Invite link, then cleared the normal Active
// approval queue same as anyone else) reads as "Guest".
export function InviteSourceTag({ source, reason }: { source: string; reason?: string | null }) {
  if (source === "manual") {
    return (
      <>
        <Tag text="Invited" tone="esc" />
        {reason && <div className="ep-sub mt-3px">{reason}</div>}
      </>
    );
  }
  if (source === "guest") return <Tag text="Guest" tone="att" />;
  return <Tag text="Eligible" tone="pos" />;
}

// "Expired" / "Expiring <date>" tag for a document with a valid-till date,
// null if neither applies (ported from kit.js's expiryTag()).
export function ExpiryTag({ expiryState, validTill }: { expiryState: string; validTill: string | null }) {
  if (expiryState === "expired") return <Tag text="Expired" tone="neg" />;
  if (expiryState === "expiring") return <Tag text={`Expiring ${fmtDate(validTill)}`} tone="att" />;
  return null;
}
