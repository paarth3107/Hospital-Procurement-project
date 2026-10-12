import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useModal } from "../../components/useModal";
import { StateTag, Tag } from "../../components/Tag";
import type { ApprovalRound, CatalogProduct, LineItem, LineItemEligibility, TenderStatus, VendorLookup } from "../../lib/types";

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
}: {
  tenderId: number;
  tenderStatus: TenderStatus;
  minInvites: number | null;
  isSystemAdmin: boolean;
  onResult: (message: string, ok: boolean) => void;
}) {
  return (
    <div className="d-flex flex-col gap-18px">
      <PublishStatusTable tenderId={tenderId} tenderStatus={tenderStatus} isSystemAdmin={isSystemAdmin} onResult={onResult} />
      <EligibilityPreview tenderId={tenderId} tenderStatus={tenderStatus} minInvites={minInvites} onResult={onResult} />
      <RoundsTable tenderId={tenderId} />
    </div>
  );
}

function RoundsTable({ tenderId }: { tenderId: number }) {
  const [rounds, setRounds] = useState<ApprovalRound[] | null>(null);

  useEffect(() => {
    api<ApprovalRound[]>(`/tenders/${tenderId}/approval-rounds`)
      .then(setRounds)
      .catch(() => setRounds([]));
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
          {!rounds?.length ? (
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
              Force-close bidding now (demo)
            </button>
          )}
          <span className="ep-k">held lines can be published later</span>
        </div>
      </div>
      <table className="ep-table" id="publish-status-table">
        <thead>
          <tr>
            <th className="ep-th">Line item</th>
            <th className="ep-th">Status</th>
            <th className="ep-th"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((li) => (
            <tr key={li.id}>
              <td className="ep-cell fw-600">{names.get(li.product_master_id) || "#" + li.product_master_id}</td>
              <td className="ep-cell">{li.published ? <Tag text="Published" tone="pos" /> : <Tag text="Held back" tone="att" />}</td>
              <td className="ep-cell text-right">
                {!li.published && (
                  <button className="ep-b" data-v="p" onClick={() => publishLine(li.id)}>
                    Publish now
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
// plus the officer's guest invites with their reasons. Every vendor on a
// line shows the same way, whether the rules, the open tender or the
// officer put it there. On a Draft of a selective tender, clicking a chip
// marks it for removal -- click as many as you want, each one highlights,
// then Remove selected vendors / Cancel appear right below the row.
function EligibilityPreview({
  tenderId,
  tenderStatus,
  minInvites,
  onResult,
}: {
  tenderId: number;
  tenderStatus: TenderStatus;
  minInvites: number | null;
  onResult: (message: string, ok: boolean) => void;
}) {
  const [preview, setPreview] = useState<LineItemEligibility[] | null>(null);
  const [activeVendors, setActiveVendors] = useState<VendorLookup[]>([]);
  const [openTender, setOpenTender] = useState(false);
  const { alertAsync, modalElement } = useModal();

  const load = useCallback(async () => {
    try {
      const [tender, prev, vendors] = await Promise.all([
        api<{ status: string; open_tender: boolean }>(`/tenders/${tenderId}`),
        api<LineItemEligibility[]>(`/tenders/${tenderId}/eligibility-preview`),
        api<VendorLookup[]>("/vendors/lookup"),
      ]);
      setOpenTender(tender.open_tender);
      setPreview(prev);
      setActiveVendors(vendors.filter((v) => v.status === "active"));
    } catch (err) {
      onResult("Could not load eligibility preview: " + (err instanceof Error ? err.message : String(err)), false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  useEffect(() => {
    load();
  }, [load]);

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
          <EligibilityLine key={p.line_item_id} p={p} tenderId={tenderId} minInvites={minInvites} canEdit={canEdit} activeVendors={activeVendors} onChanged={load} onAlert={alertAsync} />
        ))}
      </div>
      {modalElement}
    </div>
  );
}

function EligibilityLine({
  p,
  tenderId,
  minInvites,
  canEdit,
  activeVendors,
  onChanged,
  onAlert,
}: {
  p: LineItemEligibility;
  tenderId: number;
  minInvites: number | null;
  canEdit: boolean;
  activeVendors: VendorLookup[];
  onChanged: () => void;
  onAlert: (message: string, title?: string) => Promise<void>;
}) {
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [removeReason, setRemoveReason] = useState("");
  const [guestVendorId, setGuestVendorId] = useState("");
  const [guestReason, setGuestReason] = useState("");

  const none = p.eligible_vendors.length === 0;
  const short = !none && !!minInvites && p.eligible_vendors.length < minInvites;
  const invitedIds = new Set(p.eligible_vendors.map((v) => v.vendor_id));
  const candidates = activeVendors.filter((v) => !invitedIds.has(v.id));

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
    if (!removeReason.trim()) return onAlert("Give a reason. The removal is kept on record.");
    try {
      await api(`/tenders/${tenderId}/lines/${p.line_item_id}/vendor-removals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_ids: [...marked], reason: removeReason.trim() }),
      });
      setMarked(new Set());
      setRemoveReason("");
      onChanged();
    } catch (err) {
      await onAlert(err instanceof Error ? err.message : String(err));
    }
  };

  const addGuest = async () => {
    if (!guestVendorId) return onAlert("Choose a vendor to invite.");
    if (!guestReason.trim()) return onAlert("Give a reason. Guests are invited outside the eligibility rules, so the reason is kept on record.");
    try {
      await api(`/tenders/${tenderId}/lines/${p.line_item_id}/guest-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_id: Number(guestVendorId), reason: guestReason.trim() }),
      });
      setGuestVendorId("");
      setGuestReason("");
      onChanged();
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
              const label = `${v.legal_name} · ${v.rating_score.toFixed(0)}`;
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
            Remove selected vendors
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
      {canEdit && candidates.length > 0 && (
        <div className="invite-row d-flex gap-8px items-center flex-wrap mt-10px">
          <select className="input" value={guestVendorId} onChange={(e) => setGuestVendorId(e.target.value)}>
            <option value="">Invite a vendor</option>
            {candidates.map((v) => (
              <option value={v.id} key={v.id}>
                {v.legal_name}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Reason" value={guestReason} onChange={(e) => setGuestReason(e.target.value)} />
          <button type="button" className="ep-b" onClick={addGuest}>
            Invite
          </button>
        </div>
      )}
    </div>
  );
}
