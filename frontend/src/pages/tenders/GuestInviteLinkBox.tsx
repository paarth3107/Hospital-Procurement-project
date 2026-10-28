import { useModal } from "../../components/useModal";
import { api } from "../../lib/api";
import { toastError, toastSuccess } from "../../lib/toastStore";

// Ported 1:1 from frontend/js/pages/tenders/openLink.js -- renamed from
// OpenTenderLinkBox (2026-10-28, user-directed): "an open tender link
// follows the guest invite flow rather than another concept" -- there's no
// separate Guest Invite toggle/section; turning Open Tender on is still
// what generates this link, it's just branded and understood as the Guest
// Invite flow now rather than "Open Tender's registration link" -- Open
// Tender's own blanket invite of already-Active vendors is a separate
// thing (shown as "Eligible" on the approval screens, same as the
// system's own eligibility rules); a vendor who registers through THIS
// link is tagged "Guest" instead (services/guest_invite_links.py's
// invite_newly_active_vendor). The underlying column/endpoints were
// renamed to match (open_link_token -> guest_invite_token, /open-link ->
// /guest-invite-link, ?open= -> ?guest=), same day, same request.
//
// Moved into TenderDetail.tsx's "Other Vendors" card, above Approval
// Rounds, alongside Expedited Registration Review (2026-10-28,
// user-directed) -- now takes just the token/id it needs rather than a
// whole Tender, same self-contained-panel pattern every other piece of
// TenderDetail.tsx already uses (each fetches its own slice of the tender
// instead of sharing TenderEditorPage's own `tender` state). Styled as the
// same "eligibility-line" boxed row as ExpediteReviewRow's "Vendor not yet
// Active?" block right above it (2026-10-28, user-directed), not a bare div.
//
// Fully unhooked from the Open Tender toggle the same day (user-directed:
// "unhook that its no longer a dependency") -- no `enabled` prop any more;
// every button here works purely off whether a token currently exists, not
// whether Open Tender is on. The one thing Open Tender's own checkbox
// still does on this page is copy this same link + toast (TenderEditorPage.
// tsx), via the copyGuestInviteLink() helper below -- one shared flow, not
// two separate copy implementations.
export function guestInviteUrl(token: string): string {
  return `${location.origin}/?guest=${token}`;
}

export async function copyGuestInviteLink(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await navigator.clipboard.writeText(guestInviteUrl(token));
    toastSuccess("Copied the Guest Invite link to your clipboard.");
  } catch {
    toastError("Could not copy the link automatically. Check your browser's clipboard permission.");
  }
}

export function GuestInviteLinkBox({
  tenderId,
  token,
  onChange,
}: {
  tenderId: number;
  token: string | null;
  onChange: (token: string | null) => void;
}) {
  const { confirmAsync, modalElement } = useModal();

  const regenerate = async () => {
    const ok = await confirmAsync(token ? "Make a new link? The current one stops working straight away." : "Turn the Guest Invite link on for this tender?");
    if (!ok) return;
    const updated = await api<{ guest_invite_token: string | null }>(`/tenders/${tenderId}/guest-invite-link/regenerate`, { method: "POST" });
    onChange(updated.guest_invite_token);
  };

  const turnOff = async () => {
    const ok = await confirmAsync("Turn the Guest Invite link off? New vendors can't register through it until you turn it on again.");
    if (!ok) return;
    const updated = await api<{ guest_invite_token: string | null }>(`/tenders/${tenderId}/guest-invite-link`, { method: "DELETE" });
    onChange(updated.guest_invite_token);
  };

  return (
    <div className="eligibility-line">
      <div className="fs-13px fw-700">Guest Invite</div>
      <div className="fs-12px text-ink-65 mt-3px">Invite new, not-yet-registered vendors to register and bid on this tender.</div>
      <div className="d-flex gap-10px items-center flex-wrap mt-10px">
        <button type="button" className="ep-b copy-link-btn" data-v="p" disabled={!token} onClick={() => copyGuestInviteLink(token)}>
          Copy Link
        </button>
        <button type="button" className="ep-b" onClick={regenerate}>
          New Link
        </button>
        <button type="button" className="ep-b" disabled={!token} onClick={turnOff}>
          Turn Off
        </button>
      </div>
      {modalElement}
    </div>
  );
}
