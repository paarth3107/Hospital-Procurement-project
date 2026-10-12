import { useState } from "react";
import { api } from "../../lib/api";
import { useModal } from "../../components/useModal";
import type { Tender } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/openLink.js -- registration link
// for an Open Tender: copy it, make a new one (the old one stops working at
// once), or turn it off. Shown for a saved Open Tender only; a new tender
// has no link until it is saved. No visible URL field -- the column it
// lives in is too narrow to show a full link anyway, and Copy is the only
// thing anyone does with it.
const urlFor = (token: string) => `${location.origin}/?open=${token}`;

export function OpenTenderLinkBox({ tender, onChange }: { tender: Tender | null; onChange: (updated: Tender) => void }) {
  const { confirmAsync, alertAsync, modalElement } = useModal();
  const [copied, setCopied] = useState(false);

  if (!tender || !tender.open_tender) return null;
  const token = tender.open_link_token;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(urlFor(token!));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      await alertAsync("Could not copy the link automatically. Check your browser's clipboard permission.");
    }
  };

  const regenerate = async () => {
    const ok = await confirmAsync(token ? "Make a new link? The current one stops working straight away." : "Turn the link on for this tender?");
    if (!ok) return;
    onChange(await api<Tender>(`/tenders/${tender.id}/open-link/regenerate`, { method: "POST" }));
  };

  const turnOff = async () => {
    const ok = await confirmAsync("Turn the link off? New vendors can't register through it until you turn it on again.");
    if (!ok) return;
    onChange(await api<Tender>(`/tenders/${tender.id}/open-link`, { method: "DELETE" }));
  };

  return (
    <div>
      <div className="ep-k">Registration link</div>
      <div className="d-flex gap-10px items-center flex-nowrap mt-6px">
        {token && (
          <button type="button" className={`ep-b copy-link-btn${copied ? " copy-success" : ""}`} data-v="p" onClick={copy}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        )}
        <button type="button" className="ep-b" onClick={regenerate}>
          {token ? "New link" : "Turn on"}
        </button>
        {token && (
          <button type="button" className="ep-b" onClick={turnOff}>
            Turn off
          </button>
        )}
      </div>
      <div className="hint mt-6px">New vendors open this link and register. They see this tender listed once they are approved.</div>
      {modalElement}
    </div>
  );
}
