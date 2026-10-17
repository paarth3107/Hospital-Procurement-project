import { useState } from "react";
import { api } from "../../lib/api";
import { useModal } from "../../components/useModal";
import type { Tender } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/openLink.js -- registration link
// for an Open Tender: copy it, make a new one (the old one stops working at
// once), or turn it off. Always rendered (user-directed, 2026-10-16: no
// appearing/disappearing with the toggle), greyed out and inert until Open
// Tender is actually on AND the tender has been saved (a new, unsaved
// tender has no id to call the link endpoints against yet). No visible URL
// field -- the column it lives in is too narrow to show a full link
// anyway, and Copy is the only thing anyone does with it.
const urlFor = (token: string) => `${location.origin}/?open=${token}`;

export function OpenTenderLinkBox({
  tender,
  enabled,
  onChange,
}: {
  tender: Tender | null;
  // Shows (and greys out) this box even while Open Tender is off, instead
  // of the whole thing appearing/disappearing with the toggle (user-
  // directed, 2026-10-16) -- there's nothing to turn on, copy, or turn off
  // until it is.
  enabled: boolean;
  onChange: (updated: Tender) => void;
}) {
  const { confirmAsync, alertAsync, modalElement } = useModal();
  const [copied, setCopied] = useState(false);

  const token = enabled ? tender?.open_link_token ?? null : null;
  const canAct = enabled && !!tender;

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
    if (!tender) return;
    const ok = await confirmAsync(token ? "Make a new link? The current one stops working straight away." : "Turn the link on for this tender?");
    if (!ok) return;
    onChange(await api<Tender>(`/tenders/${tender.id}/open-link/regenerate`, { method: "POST" }));
  };

  const turnOff = async () => {
    if (!tender) return;
    const ok = await confirmAsync("Turn the link off? New vendors can't register through it until you turn it on again.");
    if (!ok) return;
    onChange(await api<Tender>(`/tenders/${tender.id}/open-link`, { method: "DELETE" }));
  };

  return (
    <div>
      <div className="ep-k">Registration Link</div>
      {/* Wraps (not flex-nowrap) now that this box lives in a narrower
          column (2026-10-16 reorg) -- three buttons don't reliably fit on
          one line at that width, and wrapping beats overflowing the card. */}
      <div className="d-flex gap-10px items-center flex-wrap mt-6px">
        <button type="button" className={`ep-b copy-link-btn${copied ? " copy-success" : ""}`} data-v="p" disabled={!canAct || !token} onClick={copy}>
          {copied ? "Copied!" : "Copy Link"}
        </button>
        <button type="button" className="ep-b" disabled={!canAct} onClick={regenerate}>
          New Link
        </button>
        <button type="button" className="ep-b" disabled={!canAct || !token} onClick={turnOff}>
          Turn Off
        </button>
      </div>
      <div className="hint mt-6px">Invite new vendors to register and bid.</div>
      {modalElement}
    </div>
  );
}
