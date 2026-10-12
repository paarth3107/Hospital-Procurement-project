import type { ReactNode } from "react";
import { VENDOR_DOC_TYPES } from "../../lib/constants";
import type { VendorDetail, VendorDocument } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorViewPage.js's decisionBar().
export type Decision = "approve" | "reject" | "info" | "suspend" | "blacklist" | "reinstate" | "reinstate-blacklisted";

function Btn({ label, primary, disabled, title, onClick }: { label: string; primary?: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  return (
    <button className="ep-b" data-v={primary ? "p" : undefined} disabled={disabled} title={title} onClick={onClick}>
      {label}
    </button>
  );
}

export function DecisionBar({
  vendor,
  docs,
  canReinstateBlacklisted,
  onDecide,
}: {
  vendor: VendorDetail;
  docs: VendorDocument[];
  canReinstateBlacklisted: boolean;
  onDecide: (kind: Decision) => void;
}) {
  const decidable = vendor.status === "pending_verification" || vendor.status === "info_requested";
  // The backend still allows re-sending it (a vendor can sit in
  // Info Requested a long time), but there's no reason the UI should let
  // someone fire off repeated requests while the vendor hasn't responded yet.
  const infoAlreadyRequested = vendor.status === "info_requested";
  const byType = new Map(docs.map((d) => [d.doc_type, d]));
  // A mandatory document that's Rejected or Expired is "an issue" everywhere
  // below -- it hides/de-emphasizes the positive action and makes Request
  // info the encouraged next move instead.
  const mandatoryIssue = VENDOR_DOC_TYPES.filter((t) => t.mandatory).some((t) => {
    const d = byType.get(t.value);
    return d?.status === "rejected" || d?.expiry_state === "expired";
  });

  const Bar = ({ text, buttons, banner }: { text: string; buttons: ReactNode; banner?: string }) => (
    <>
      {banner && <div className="ep-note warn">{banner}</div>}
      <div className="ep-pane padding-14px-16px d-flex items-center gap-12px">
        <div className="flex-1 fs-12-5px text-ink-68 lh-1-45">{text}</div>
        {buttons}
      </div>
    </>
  );
  const issueBanner = (text: string) => (mandatoryIssue ? text : undefined);

  if (decidable) {
    return (
      <Bar
        text="Every mandatory document must be Verified before approval. Approval activates the vendor and opens category mapping."
        banner={issueBanner("A mandatory document has been rejected or has expired. Either reject this registration outright, or request the documents again with a note explaining what's needed.")}
        buttons={
          <>
            {!mandatoryIssue && <Btn label="Approve & activate" primary onClick={() => onDecide("approve")} />}
            <Btn
              label={infoAlreadyRequested ? "Info already requested" : "Request info"}
              primary={mandatoryIssue}
              disabled={infoAlreadyRequested}
              title={infoAlreadyRequested ? "Already waiting on the vendor to respond" : undefined}
              onClick={() => onDecide("info")}
            />
            <Btn label="Reject candidate" onClick={() => onDecide("reject")} />
          </>
        }
      />
    );
  }
  if (vendor.status === "active") {
    return (
      <Bar
        text="Suspending blocks bidding, new mappings and new invitations, and keeps history and mappings. Blacklisting also blocks login; reinstating a blacklisted vendor needs an explicit reason."
        banner={issueBanner("A mandatory document has been rejected or has expired.")}
        buttons={
          <>
            <Btn label="Request info" primary={mandatoryIssue} onClick={() => onDecide("info")} />
            <Btn label="Suspend vendor" onClick={() => onDecide("suspend")} />
            <Btn label="Blacklist" onClick={() => onDecide("blacklist")} />
          </>
        }
      />
    );
  }
  if (vendor.status === "suspended") {
    return (
      <Bar
        text="This vendor is suspended and can't bid or be invited. Reinstate once the issue is resolved."
        banner={issueBanner("A mandatory document has been rejected or has expired. The vendor must resubmit it and you must verify it before this vendor can be reinstated.")}
        buttons={
          <>
            {!mandatoryIssue && <Btn label="Reinstate" primary onClick={() => onDecide("reinstate")} />}
            <Btn label="Request info" primary={mandatoryIssue} onClick={() => onDecide("info")} />
            <Btn label="Blacklist" onClick={() => onDecide("blacklist")} />
          </>
        }
      />
    );
  }
  if (vendor.status === "blacklisted") {
    if (!canReinstateBlacklisted) {
      return <div className="ep-pane ep-pane-pad hint">This vendor is blacklisted. Reinstating it needs an explicit reason.</div>;
    }
    return (
      <Bar
        text="This vendor is blacklisted and cannot log in or bid. Reinstating needs an explicit reason, which is kept in the status history."
        buttons={<Btn label="Reinstate vendor" primary onClick={() => onDecide("reinstate-blacklisted")} />}
      />
    );
  }
  return <div className="ep-pane ep-pane-pad hint">This vendor is {vendor.status}; no decision is pending.</div>;
}
