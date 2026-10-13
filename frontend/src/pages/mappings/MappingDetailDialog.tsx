import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api";
import { docLabel, docKey, entryKey } from "../../lib/constants";
import { fmtDateTime } from "../../lib/format";
import { mappingHistory } from "../../lib/mappingActions";
import type { MappingData } from "../../lib/mappingData";
import type { CatalogProduct, Category, MappingHistoryEntry, VendorDocument, VendorLookup, VendorMapping } from "../../lib/types";
import { StateTag, Tag } from "../../components/Tag";
import type { useMappingActions } from "./useMappingActions";

// The detail dialog behind every matrix cell (and, soon, every Mapping
// Requests row): facts, scope, versioned history, and the one set of
// actions valid for the mapping's current state. Ported 1:1 from
// frontend/js/pages/mappings/mappingDialog.js. Deliberately does NOT reuse
// the vanilla app's shared #app-dialog/#app-dialog-box nodes -- own portal,
// same CSS classes, same pattern as every other dialog this migration has
// ported (AuditDetailDialog, Vendor View's prompt/confirm dialogs).
//
// Matches the vanilla ordering exactly, including its one real quirk:
// clicking any action button closes this dialog FIRST, then runs the
// prompt/confirm + API call -- so cancelling a reason prompt just leaves the
// dialog closed, it doesn't reopen. `actions` (useMappingActions, owned by
// the parent page) is what actually performs each action and shows its own
// error/modal state after this dialog is gone.
type Target = { kind: "category"; target: Category } | { kind: "item"; target: CatalogProduct };

export function MappingDetailDialog({
  data,
  vendor,
  mapping,
  actions,
  onClose,
  ...targetInfo
}: Target & {
  data: MappingData;
  vendor: VendorLookup;
  mapping: VendorMapping | undefined;
  actions: ReturnType<typeof useMappingActions>;
  onClose: () => void;
}) {
  const isCategory = targetInfo.kind === "category";
  const target = targetInfo.target;
  const type = target.procurement_type;
  const targetLabel = isCategory ? `the "${target.name}" category` : `"${target.name}"`;
  const categoryIdOfProduct = targetInfo.kind === "item" ? targetInfo.target.category_id : null;
  const minRating = isCategory ? target.min_mapping_rating : target.min_mapping_rating ?? (categoryIdOfProduct != null ? data.categoryById.get(categoryIdOfProduct)?.min_mapping_rating : null) ?? null;
  const rating = data.ratingScore(vendor.id, type);
  const state = mapping ? mapping.state : null;

  const [history, setHistory] = useState<MappingHistoryEntry[]>([]);
  useEffect(() => {
    if (!mapping) {
      setHistory([]);
      return;
    }
    mappingHistory(mapping.id)
      .then((h) => setHistory(h.slice().reverse()))
      .catch(() => setHistory([]));
  }, [mapping?.id]);

  const requiredTypes = [
    ...new Set([...(isCategory ? [] : target.required_documents || []), ...((isCategory ? target : data.categoryById.get(categoryIdOfProduct!))?.required_documents || [])]),
  ];
  const [vendorDocs, setVendorDocs] = useState<VendorDocument[]>([]);
  useEffect(() => {
    if (!requiredTypes.length) {
      setVendorDocs([]);
      return;
    }
    api<VendorDocument[]>(`/vendors/${vendor.id}/documents`)
      .then(setVendorDocs)
      .catch(() => setVendorDocs([]));
  }, [vendor.id, requiredTypes.join("|")]);

  const facts: [string, string][] = [
    ["Procurement type", type],
    ["Mapping scope", isCategory ? "Whole category" : `Single item in ${(target as CatalogProduct).category}`],
    ["Requested", mapping ? fmtDateTime(mapping.requested_at) : "—"],
    ["Last decision", mapping?.decided_at ? fmtDateTime(mapping.decided_at) : "—"],
    ["Version", mapping ? String(mapping.version) : "—"],
    ["Minimum rating to map", minRating != null ? `${minRating} (restricted)` : "None"],
    [`Vendor rating (${type})`, `${rating.toFixed(1)} / 100`],
    ["Vendor status", vendor.status.replace("_", " ")],
  ];

  const items: CatalogProduct[] = isCategory ? data.products.filter((p) => p.category_id === target.id) : [target as CatalogProduct];
  const categoryApproved = (isCategory ? mapping : data.categoryMappingOf(vendor.id, categoryIdOfProduct!))?.state === "approved";

  const close = () => onClose();
  const act = (fn: () => void) => {
    close(); // vanilla closes the dialog before the action resolves -- see the note above
    fn();
  };

  return createPortal(
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog-box">
        <div className="dlg-head">
          <div className="flex-1">
            <div className="ep-k">
              {isCategory ? "Category" : "Item"} mapping · {type}
            </div>
            <h4>
              {vendor.legal_name} → {target.name}
            </h4>
          </div>
          <StateTag state={state ?? "none"} />
        </div>
        <div className="dlg-body">
          <div>
            <div className="fact-grid">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <div className="ep-k">{k}</div>
                  <div className="fact-value">{v}</div>
                </div>
              ))}
            </div>
            {requiredTypes.length > 0 && (
              <>
                <div className="h-2px bg-ink-35 margin-15px-0-11px"></div>
                <div className="ep-k">Required documents</div>
                <div className="d-flex flex-col gap-6px mt-7px">
                  {requiredTypes.map((t) => {
                    const d = vendorDocs.find((x) => docKey(x) === entryKey(t));
                    const status = !d ? <Tag text="Not uploaded" tone="att" /> : d.expiry_state === "expired" ? <Tag text="Expired" tone="neg" /> : <StateTag state={d.status} />;
                    return (
                      <div className="d-flex justify-between gap-10px fs-12px" key={t}>
                        <span>{docLabel(t)}</span>
                        {status}
                      </div>
                    );
                  })}
                  <div className="hint">Approving needs each one Verified — review them under Vendor registrations.</div>
                </div>
              </>
            )}
            <div className="h-2px bg-ink-35 margin-15px-0-11px"></div>
            <div className="ep-k">Mapping history</div>
            <div className="d-flex flex-col gap-8px mt-7px">
              {history.length ? (
                history.map((h) => (
                  <div className="hist" key={h.id}>
                    <div className="hist-when">{fmtDateTime(h.at)}</div>
                    <div className="fs-12px lh-1-4">
                      {h.from_state ? `${h.from_state} → ` : ""}
                      <b>{h.to_state}</b>
                      {h.reason ? ` — ${h.reason}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div className="hint">No history yet — this pair has never been mapped.</div>
              )}
            </div>
          </div>
          <div>
            <div className="ep-k">{isCategory ? "SKUs / items in scope" : "Item in scope"}</div>
            <table className="ep-table mt-7px">
              <thead>
                <tr>
                  <th className="ep-th">Code</th>
                  <th className="ep-th">Entry</th>
                  <th className="ep-th">State</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const m = data.itemMappingOf(vendor.id, p.id);
                  const fallback = categoryApproved ? "via category" : "—";
                  return (
                    <tr key={p.id}>
                      <td className="ep-cell ep-mono fs-11-5px">{p.code}</td>
                      <td className="ep-cell fs-12px">{p.name}</td>
                      <td className="ep-cell">{m ? <StateTag state={m.state} /> : <span className="ep-sub">{fallback}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="hint mt-11px">
              Approving a category does not map every item in it as a separate record, but an approved category makes the vendor eligible for its items at tender time. An item
              mapping can add to that or suspend a single item.
            </div>
          </div>
        </div>
        <div className="dlg-foot">
          <div className="hint">This matrix is the single source of truth for who can be invited at tender time.</div>
          <button className="ep-b" onClick={close}>
            Close
          </button>
          {state === null && (
            <button
              className="ep-b"
              data-v="p"
              onClick={() => act(() => actions.mapAndApprove(vendor, isCategory ? { category_id: target.id } : { product_master_id: (target as CatalogProduct).id }))}
            >
              Map &amp; approve
            </button>
          )}
          {state === "pending" && mapping && (
            <>
              <button className="ep-b" onClick={() => act(() => actions.reject(mapping.id))}>
                Reject
              </button>
              <button className="ep-b" data-v="p" onClick={() => act(() => actions.approve(mapping.id))}>
                Approve
              </button>
            </>
          )}
          {state === "approved" && mapping && (
            <button className="ep-b" data-v="p" onClick={() => act(() => actions.suspend(mapping.id, vendor, targetLabel))}>
              Suspend mapping
            </button>
          )}
          {state === "suspended" && mapping && (
            <button className="ep-b" data-v="p" onClick={() => act(() => actions.reinstate(mapping.id, vendor, targetLabel))}>
              Reinstate
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
