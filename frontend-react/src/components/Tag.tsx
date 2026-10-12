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
  pending_approval: "att", info_requested: "esc", escalated: "esc",
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

// "Expired" / "Expiring <date>" tag for a document with a valid-till date,
// null if neither applies (ported from kit.js's expiryTag()).
export function ExpiryTag({ expiryState, validTill }: { expiryState: string; validTill: string | null }) {
  if (expiryState === "expired") return <Tag text="Expired" tone="neg" />;
  if (expiryState === "expiring") return <Tag text={`Expiring ${fmtDate(validTill)}`} tone="att" />;
  return null;
}
