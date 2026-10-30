import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { useModal } from "../../components/useModal";
import { StateTag, Tag } from "../../components/Tag";
import { GuestInviteLinkBox } from "./GuestInviteLinkBox";
import type { ApprovalRound, CatalogProduct, ExcludedVendor, LineItem, LineItemEligibility, OverrideOut, TenderStatus, VendorLookup } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/tenderDetail.js. Shown below the
// header form for a saved tender: which lines are live vs held back, a
// preview of who the system would currently invite per line, and the
// approval rounds.
export function TenderDetail({
  tenderId,
  tenderStatus,
  minInvites,
  isSystemAdmin,
  onResult,
  refreshToken,
}: {
  tenderId: number;
  tenderStatus: TenderStatus;
  minInvites: number | null;
  isSystemAdmin: boolean;
  onResult: (message: string, ok: boolean) => void;
  // Bumped by the parent on every successful Save as Draft -- tenderId alone
  // doesn't change across saves, so without this the panels below never
  // re-fetched after one (real bug, found 2026-10-14: adding a line and
  // saving left Eligible Vendors showing stale data until the tender was
  // closed and reopened).
  refreshToken: number;
}) {
  return (
    <div className="d-flex flex-col gap-18px">
      <PublishStatusTable tenderId={tenderId} tenderStatus={tenderStatus} isSystemAdmin={isSystemAdmin} onResult={onResult} />
      <DueDateExtensionPanel tenderId={tenderId} tenderStatus={tenderStatus} onResult={onResult} refreshToken={refreshToken} />
      <EligibilityPreview tenderId={tenderId} tenderStatus={tenderStatus} minInvites={minInvites} onResult={onResult} refreshToken={refreshToken} />
      <OtherVendorsPanel tenderId={tenderId} tenderStatus={tenderStatus} onResult={onResult} refreshToken={refreshToken} />
      <RoundsTable tenderId={tenderId} />
    </div>
  );
}

// Spec §9.6 -- the tender editor's own "Save as Draft" already refuses to
// touch bid_due_date once the tender isn't Draft (TenderEditorPage.tsx's
// whole header fieldset is disabled={!editable}), so this governed override
// is the only path to move a Published/Scheduled tender's deadline. Under
// the seeded cumulative-days threshold it self-attests instantly (no
// decision needed); over it, lands pending for Category Manager -- same
// "Decisions" tab every other escalated override now routes through.
function DueDateExtensionPanel({
  tenderId,
  tenderStatus,
  onResult,
  refreshToken,
}: {
  tenderId: number;
  tenderStatus: TenderStatus;
  onResult: (message: string, ok: boolean) => void;
  refreshToken: number;
}) {
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [newDueDate, setNewDueDate] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await api<{ bid_due_date: string | null }>(`/tenders/${tenderId}`);
      setDueDate(t.bid_due_date);
    } catch {
      // Not critical -- the panel below just won't show a current date.
    }
  }, [tenderId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  if (tenderStatus !== "published" && tenderStatus !== "scheduled") return null;

  const submit = async () => {
    if (!newDueDate) return onResult("Pick a new due date.", false);
    if (!justification.trim()) return onResult("A justification is required.", false);
    setBusy(true);
    try {
      const res = await api<{ status: string; required_approver_role: string | null }>(`/tenders/${tenderId}/bid-due-date-extension`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_due_date: new Date(newDueDate).toISOString(), justification: justification.trim() }),
      });
      onResult(
        res.status === "approved" ? "Due date extended." : `Sent to ${res.required_approver_role?.replace(/_/g, " ") ?? "the approver"} for a decision.`,
        true
      );
      setNewDueDate("");
      setJustification("");
      load();
    } catch (err) {
      onResult(err instanceof Error ? err.message : String(err), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Bid Due Date</span>
        <span className="ep-k">Current: {dueDate ? fmtDateTime(dueDate) : "—"}</span>
      </div>
      <div className="ep-pane-pad invite-row d-flex gap-8px items-center flex-wrap">
        <input className="input" type="datetime-local" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} />
        <input className="input" placeholder="Justification" value={justification} onChange={(e) => setJustification(e.target.value)} />
        <button type="button" className="ep-b" disabled={busy} onClick={submit}>
          Request extension
        </button>
      </div>
    </div>
  );
}

function RoundsTable({ tenderId }: { tenderId: number }) {
  const [rounds, setRounds] = useState<ApprovalRound[] | null>(null);
  // Real bug, found 2026-10-15: a failed fetch here used to render exactly
  // like "not submitted yet" -- indistinguishable from a tender that
  // genuinely has no approval rounds.
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    api<ApprovalRound[]>(`/tenders/${tenderId}/approval-rounds`)
      .then(setRounds)
      .catch(() => setError(true));
  }, [tenderId]);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Approval Rounds</span>
      </div>
      <table className="ep-table" id="round-table">
        <thead>
          <tr>
            {["Round", "Decision", "Tier", "Comments"].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {error ? (
            <tr>
              <td className="ep-cell text-danger-700" colSpan={4}>
                Could not load approval rounds — try reopening this tender.
              </td>
            </tr>
          ) : !rounds?.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={4}>
                Not submitted yet.
              </td>
            </tr>
          ) : (
            rounds
              .slice()
              .reverse()
              .map((r) => (
                <tr key={r.id}>
                  <td className="ep-cell">{r.round_number}</td>
                  <td className="ep-cell">
                    <StateTag state={r.decision} />
                  </td>
                  <td className="ep-cell">Tier {r.required_tier}</td>
                  <td className="ep-cell">{r.comments || ""}</td>
                </tr>
              ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// For a Published tender: which lines are live and which are held back (no
// eligible vendor at approval time). A held line can be published later.
function PublishStatusTable({
  tenderId,
  tenderStatus,
  isSystemAdmin,
  onResult,
}: {
  tenderId: number;
  tenderStatus: TenderStatus;
  isSystemAdmin: boolean;
  onResult: (message: string, ok: boolean) => void;
}) {
  const [lines, setLines] = useState<LineItem[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [closed, setClosed] = useState(false);

  const load = useCallback(async () => {
    if (tenderStatus !== "published") return;
    const [items, products] = await Promise.all([api<LineItem[]>(`/tenders/${tenderId}/line-items`), api<CatalogProduct[]>("/products")]);
    setLines(items);
    setNames(new Map(products.map((p) => [p.id, p.name])));
  }, [tenderId, tenderStatus]);

  useEffect(() => {
    load();
  }, [load]);

  if (tenderStatus !== "published") return null;

  const publishLine = async (lineId: number) => {
    try {
      await api(`/tenders/${tenderId}/line-items/${lineId}/publish`, { method: "POST" });
      onResult("Line published to its eligible vendors.", true);
      load();
    } catch (err) {
      onResult("Could not publish line: " + (err instanceof Error ? err.message : String(err)), false);
    }
  };

  const forceCloseBidding = async () => {
    try {
      await api(`/tenders/${tenderId}/force-close-bidding`, { method: "POST" });
      onResult("Bidding force-closed for this tender (demo utility — not a real deadline pass).", true);
      setClosed(true);
    } catch (err) {
      onResult("Could not force-close bidding: " + (err instanceof Error ? err.message : String(err)), false);
    }
  };

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Line Publishing</span>
        <div className="d-flex items-center gap-12px">
          {isSystemAdmin && !closed && (
            <button className="ep-b" onClick={forceCloseBidding}>
              Force-Close Bidding Now (Demo)
            </button>
          )}
          <span className="ep-k">held lines can be published later</span>
        </div>
      </div>
      <table className="ep-table" id="publish-status-table">
        <thead>
          <tr>
            <th className="ep-th">Line Item</th>
            <th className="ep-th">Status</th>
            <th className="ep-th"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((li) => (
            <tr key={li.id}>
              <td className="ep-cell fw-600">{names.get(li.product_master_id) || "#" + li.product_master_id}</td>
              <td className="ep-cell">{li.published ? <Tag text="Published" tone="pos" /> : <Tag text="Held Back" tone="att" />}</td>
              <td className="ep-cell text-right">
                {!li.published && (
                  <button className="ep-b" data-v="p" onClick={() => publishLine(li.id)}>
                    Publish Now
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Filter-chain style preview: one block per line with its eligible vendors,
// plus the officer's manual invites (spec §6.6) with their reasons. Every vendor on a
// line shows the same way, whether the rules, the open tender or the
// officer put it there. On a Draft of a selective tender, clicking a chip
// marks it for removal -- click as many as you want, each one highlights,
// then Remove selected vendors / Cancel appear right below the row.
function EligibilityPreview({
  tenderId,
  tenderStatus,
  minInvites,
  onResult,
  refreshToken,
}: {
  tenderId: number;
  tenderStatus: TenderStatus;
  minInvites: number | null;
  onResult: (message: string, ok: boolean) => void;
  refreshToken: number;
}) {
  const [preview, setPreview] = useState<LineItemEligibility[] | null>(null);
  const [activeVendors, setActiveVendors] = useState<VendorLookup[]>([]);
  const [openTender, setOpenTender] = useState(false);
  // Every manual-invite request made for this tender's lines, pending or
  // decided (2026-10-30, user-reported: "I can't see who was added" -- a
  // request was only ever visible once approved, as a plain chip among
  // eligible_vendors indistinguishable from a system-resolved one; a
  // pending or rejected request left no trace on screen at all).
  const [manualRequestsByLine, setManualRequestsByLine] = useState<Map<number, OverrideOut[]>>(new Map());
  const { alertAsync, modalElement } = useModal();

  const load = useCallback(async () => {
    try {
      const [tender, prev, vendors, overridesList] = await Promise.all([
        api<{ status: string; open_tender: boolean }>(`/tenders/${tenderId}`),
        api<LineItemEligibility[]>(`/tenders/${tenderId}/eligibility-preview`),
        api<VendorLookup[]>("/vendors/lookup"),
        api<OverrideOut[]>("/overrides?override_type=invite_list_manual_add"),
      ]);
      setOpenTender(tender.open_tender);
      setPreview(prev);
      setActiveVendors(vendors.filter((v) => v.status === "active"));
      const byLine = new Map<number, OverrideOut[]>();
      const lineIds = new Set(prev.map((p) => p.line_item_id));
      for (const o of overridesList) {
        if (o.entity_type !== "tender_line_item" || o.entity_id == null || !lineIds.has(o.entity_id)) continue;
        byLine.set(o.entity_id, [...(byLine.get(o.entity_id) ?? []), o]);
      }
      setManualRequestsByLine(byLine);
    } catch (err) {
      onResult("Could not load eligibility preview: " + (err instanceof Error ? err.message : String(err)), false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshToken]);

  // User-directed (2026-10-13): removing a vendor used to re-fetch the whole
  // tender's eligibility preview (every line, plus the tender and
  // vendor-lookup calls) from the server, even though the officer's action
  // only ever changes ONE line, and we already have every piece of data the
  // new state needs in hand -- it just moves an entry that's already fully
  // rendered from "eligible" to "removed" with the reason just typed, so
  // this patches `preview` in place instead of reloading it. (A manual
  // invite used to get the same optimistic treatment -- removed 2026-10-22
  // when the request became governed: there's no vendor to add to
  // `eligible_vendors` until Category Manager approves it, which doesn't
  // happen in this session.)
  const onVendorsRemoved = (lineItemId: number, removed: ExcludedVendor[]) => {
    const removedIds = new Set(removed.map((r) => r.vendor_id));
    setPreview(
      (prev) =>
        prev &&
        prev.map((p) =>
          p.line_item_id === lineItemId
            ? { ...p, eligible_vendors: p.eligible_vendors.filter((v) => !removedIds.has(v.vendor_id)), removed_vendors: [...p.removed_vendors, ...removed] }
            : p
        )
    );
  };

  const canEdit = tenderStatus === "draft" && !openTender;

  if (!preview) return null;

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Eligible Vendors Per Line</span>
        <span className="ep-k">Save as a draft to update vendors</span>
      </div>
      <div className="ep-pane-pad">
        {openTender && <div className="ep-note mb-10px">Open tender: every Active vendor is invited on every line.</div>}
        {preview.map((p) => (
          <EligibilityLine
            key={p.line_item_id}
            p={p}
            tenderId={tenderId}
            minInvites={minInvites}
            canEdit={canEdit}
            activeVendors={activeVendors}
            manualRequests={manualRequestsByLine.get(p.line_item_id) ?? []}
            onVendorsRemoved={onVendorsRemoved}
            onManualInviteRequested={load}
            onAlert={alertAsync}
          />
        ))}
      </div>
      {modalElement}
    </div>
  );
}

// Everything that reaches this tender's vendor list from outside the
// normal eligibility rules AND outside Manual Invite (2026-10-28,
// user-directed): Expedited Registration Review first (an override --
// flags an urgent not-yet-Active vendor, spec §6.7/§12.3), then Guest
// Invite second (the registration link for brand-new vendors). Combined
// into one "Other Vendors" card, placed above Approval Rounds. Each half
// fetches its own slice of the tender/vendor-lookup data, same
// self-contained-panel pattern every other piece of this file already
// uses, rather than threading more props down from TenderEditorPage.
function OtherVendorsPanel({
  tenderId,
  tenderStatus,
  onResult,
  refreshToken,
}: {
  tenderId: number;
  tenderStatus: TenderStatus;
  onResult: (message: string, ok: boolean) => void;
  refreshToken: number;
}) {
  const [pendingVendors, setPendingVendors] = useState<VendorLookup[]>([]);
  const [guestToken, setGuestToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, vendors] = await Promise.all([
        api<{ guest_invite_token: string | null }>(`/tenders/${tenderId}`),
        api<VendorLookup[]>("/vendors/lookup"),
      ]);
      setGuestToken(t.guest_invite_token);
      // A vendor stuck in the registration queue can't be manually invited
      // (that's Active-only, spec §6.6) -- this is the pool Expedited
      // Registration Review below can flag instead, spec §6.7/§12.3.
      setPendingVendors(vendors.filter((v) => v.status === "pending_verification" || v.status === "info_requested"));
    } catch {
      // Not critical -- the panel below just won't show current state.
    }
  }, [tenderId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // Expedited review needs no draft/open-tender restriction -- unlike a
  // manual invite (which pre-populates an invite list that only matters
  // pre-publish), the urgency this flags is usually strongest once the
  // tender's Published and its deadline is close. The backend's own guard
  // (CLOSED_TENDER_STATUSES) is what actually blocks a closed tender.
  const tenderClosed = tenderStatus === "withdrawn" || tenderStatus === "no_award" || tenderStatus === "awarded";

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Other Vendors</span>
      </div>
      <div className="ep-pane-pad d-flex flex-col gap-18px">
        {!tenderClosed && pendingVendors.length > 0 && <ExpediteReviewRow tenderId={tenderId} pendingVendors={pendingVendors} onResult={onResult} />}
        <GuestInviteLinkBox tenderId={tenderId} token={guestToken} onChange={setGuestToken} />
      </div>
    </div>
  );
}

// Spec §6.7/§12.3's Expedited Registration Review (backend/app/routers/
// vendors.py) -- a vendor stuck in the registration queue can't be manually
// invited (that needs Active), so this is the only way an Officer can flag
// one as urgent for this tender. Ungoverned (2026-10-22, user-directed):
// applies immediately, no approval step -- Category Manager still has to
// review/approve the vendor itself regardless, through the already-governed
// flow, so gating the urgency label behind its own decision was pure
// friction with no matching risk.
function ExpediteReviewRow({
  tenderId,
  pendingVendors,
  onResult,
}: {
  tenderId: number;
  pendingVendors: VendorLookup[];
  onResult: (message: string, ok: boolean) => void;
}) {
  const [vendorId, setVendorId] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!vendorId) return onResult("Choose a pending vendor to flag.", false);
    if (!justification.trim()) return onResult("A justification is required.", false);
    setBusy(true);
    try {
      // Ungoverned (2026-10-22, user-directed) -- applies immediately, no
      // approval step. The flag has no power on its own; it only sorts/
      // labels the vendor on the existing, already-governed review queue.
      await api(`/vendors/${vendorId}/expedited-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tender_id: tenderId, justification: justification.trim() }),
      });
      const vendor = pendingVendors.find((v) => String(v.id) === vendorId);
      onResult(`Flagged urgent -- ${vendor?.legal_name ?? "vendor"}'s review is now prioritized.`, true);
      setVendorId("");
      setJustification("");
    } catch (err) {
      onResult(err instanceof Error ? err.message : String(err), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eligibility-line mt-10px">
      <div className="fs-13px fw-700">Vendor not yet Active?</div>
      <div className="fs-12px text-ink-65 mt-3px">
        A vendor still in registration review can't be manually invited yet. If one needs to clear review before this tender's deadline, flag it here.
      </div>
      <div className="invite-row d-flex gap-8px items-center flex-wrap mt-10px">
        <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
          <option value="">Pending vendor...</option>
          {pendingVendors.map((v) => (
            <option value={v.id} key={v.id}>
              {v.legal_name}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Justification" value={justification} onChange={(e) => setJustification(e.target.value)} />
        <button type="button" className="ep-b" disabled={busy} onClick={submit}>
          Flag as urgent
        </button>
      </div>
    </div>
  );
}

function EligibilityLine({
  p,
  tenderId,
  minInvites,
  canEdit,
  activeVendors,
  manualRequests,
  onVendorsRemoved,
  onManualInviteRequested,
  onAlert,
}: {
  p: LineItemEligibility;
  tenderId: number;
  minInvites: number | null;
  canEdit: boolean;
  activeVendors: VendorLookup[];
  // Every manual-invite request made for THIS line, pending or decided --
  // user-reported 2026-10-30: "I can't see who was added." An approved one
  // already shows as a plain chip above (merged into p.eligible_vendors by
  // the backend), but this is the only place a pending or rejected request
  // is visible at all.
  manualRequests: OverrideOut[];
  onVendorsRemoved: (lineItemId: number, removed: ExcludedVendor[]) => void;
  onManualInviteRequested: () => void;
  onAlert: (message: string, title?: string) => Promise<void>;
}) {
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [removeReason, setRemoveReason] = useState("");
  const [manualVendorId, setManualVendorId] = useState("");
  const [manualJustification, setManualJustification] = useState("");

  const none = p.eligible_vendors.length === 0;
  const short = !none && !!minInvites && p.eligible_vendors.length < minInvites;
  const invitedIds = new Set(p.eligible_vendors.map((v) => v.vendor_id));
  const candidates = activeVendors.filter((v) => !invitedIds.has(v.id));
  // Manual Invite picker label hint (2026-10-23, user-directed): a short,
  // visible heads-up that a candidate has no rating history yet but can
  // still be given a shot, right where the officer is choosing who to add.
  const unratedCandidateIds = new Set(p.unrated_vendor_ids);

  const toggleChip = (vendorId: number) =>
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(vendorId)) next.delete(vendorId);
      else next.add(vendorId);
      return next;
    });

  const cancelRemove = () => {
    setMarked(new Set());
    setRemoveReason("");
  };

  const confirmRemove = async () => {
    if (!marked.size) return onAlert("Click a vendor's chip to select it for removal.");
    const reason = removeReason.trim();
    if (!reason) return onAlert("Give a reason. The removal is kept on record.");
    try {
      await api(`/tenders/${tenderId}/lines/${p.line_item_id}/vendor-removals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_ids: [...marked], reason }),
      });
      // Nothing to ask the server for -- every marked vendor is already
      // fully rendered (name included) right above, and the reason was just
      // typed in. Move them from eligible to removed locally.
      const removed = p.eligible_vendors.filter((v) => marked.has(v.vendor_id)).map((v) => ({ vendor_id: v.vendor_id, legal_name: v.legal_name, reason }));
      onVendorsRemoved(p.line_item_id, removed);
      setMarked(new Set());
      setRemoveReason("");
    } catch (err) {
      await onAlert(err instanceof Error ? err.message : String(err));
    }
  };

  const addManualInvite = async () => {
    if (!manualVendorId) return onAlert("Choose a vendor to invite.");
    if (!manualJustification.trim()) return onAlert("A justification is required -- this invite is outside the eligibility rules, so it's a governed override.");
    const vendorId = Number(manualVendorId);
    try {
      // Spec §6.6/§12.3, governed since 2026-10-22 (reversing the
      // 2026-10-06 "no second approval step" decision) -- this only
      // requests the override now. The vendor doesn't appear in
      // `eligible_vendors` until Category Manager (or, past the
      // cumulative-value threshold, Approving Authority) approves it
      // elsewhere, so there's nothing to optimistically patch here anymore.
      const res = await api<{ status: string; required_approver_role: string | null }>(`/tenders/${tenderId}/lines/${p.line_item_id}/manual-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_id: vendorId, justification: manualJustification.trim() }),
      });
      // Real bug, found 2026-10-30, user-reported: this always said "Sent
      // to category manager" even when self_attested (System Admin, since
      // 2026-10-30) auto-approved the request on the spot -- nothing was
      // ever actually sent to anyone in that case, the vendor's already
      // invited. Branch on the status the backend actually returned.
      await onAlert(
        res.status === "approved"
          ? "The vendor is invited."
          : `Sent to ${res.required_approver_role?.replace(/_/g, " ") ?? "the approver"} for a decision.`,
        "Manual invite requested"
      );
      setManualVendorId("");
      setManualJustification("");
      onManualInviteRequested(); // so this request shows up in the list below right away
    } catch (err) {
      await onAlert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className={`eligibility-line ${none ? "eligibility-none" : short ? "eligibility-short" : "eligibility-ok"}`}>
      <div className="d-flex justify-between gap-12px">
        <b className="fs-13px">{p.product_name}</b>
        <span className="ep-sub">threshold {p.threshold_applied}</span>
      </div>
      {none ? (
        <div className="fs-12px text-danger-700 mt-3px">Zero vendors qualified. This line is held back while the others go live, unless a vendor is invited below.</div>
      ) : (
        <>
          <div className="d-flex flex-wrap gap-6px mt-6px">
            {p.eligible_vendors.map((v) => {
              const label = `${v.legal_name} · ${v.is_unrated ? "Unrated" : v.rating_score.toFixed(0)}`;
              return canEdit ? (
                <button
                  type="button"
                  key={v.vendor_id}
                  className={`ep-tag ep-tag-action${marked.has(v.vendor_id) ? " marked-remove" : ""}`}
                  onClick={() => toggleChip(v.vendor_id)}
                >
                  {label}
                </button>
              ) : (
                <span className="ep-tag" key={v.vendor_id}>
                  {label}
                </span>
              );
            })}
          </div>
          {short && <div className="fs-12px text-warning mt-5px">Below the configured minimum of {minInvites} vendor(s).</div>}
        </>
      )}
      {canEdit && marked.size > 0 && (
        <div className="d-flex gap-8px items-center flex-wrap mt-10px">
          <span className="ep-sub">{marked.size} selected</span>
          <input className="input" placeholder="Reason for removing" value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} />
          <button type="button" className="ep-b" data-v="p" onClick={confirmRemove}>
            Remove Selected Vendors
          </button>
          <button type="button" className="ep-b" onClick={cancelRemove}>
            Cancel
          </button>
        </div>
      )}
      {/* No Restore button -- a removed vendor can just be invited again from the dropdown below, same as anyone else. */}
      {p.removed_vendors.map((r) => (
        <div className="ep-sub mt-6px" key={r.vendor_id}>
          Removed: {r.legal_name}. {r.reason}
        </div>
      ))}
      {/* Every manual-invite request made for this line, pending or decided
          (2026-10-30, user-reported: "I can't see who was added") -- an
          Approved one is also already showing as a plain chip above (merged
          into p.eligible_vendors), but this is the only trace of a Pending
          or Rejected one anywhere on screen. */}
      {manualRequests.length > 0 && (
        <div className="mt-8px">
          <div className="fs-12px fw-700 text-ink-65">Previously invited vendors</div>
          {manualRequests.map((o) => (
            <div className="d-flex items-center gap-8px flex-wrap mt-4px" key={o.id}>
              <StateTag state={o.status} />
              <span className="fs-12-5px fw-600">{o.proposed_change?.vendor_name ?? "Vendor"}</span>
              <span className="ep-sub">— {o.justification}</span>
              {o.status === "rejected" && o.decision_reason && <span className="ep-sub text-danger-700">({o.decision_reason})</span>}
            </div>
          ))}
        </div>
      )}
      {canEdit && candidates.length > 0 && (
        <div className="invite-row d-flex gap-8px items-center flex-wrap mt-10px">
          <select className="input" value={manualVendorId} onChange={(e) => setManualVendorId(e.target.value)}>
            <option value="">Invite a Vendor</option>
            {candidates.map((v) => (
              <option value={v.id} key={v.id}>
                {v.legal_name}
                {unratedCandidateIds.has(v.id) ? " (Unrated)" : ""}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Justification" value={manualJustification} onChange={(e) => setManualJustification(e.target.value)} />
          <button type="button" className="ep-b" onClick={addManualInvite}>
            Request invite
          </button>
        </div>
      )}
    </div>
  );
}
