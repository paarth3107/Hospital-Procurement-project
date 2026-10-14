import { forwardRef, Fragment, useImperativeHandle, useState } from "react";
import { api, API_BASE, apiHeaders, uploadWithProgress } from "../../lib/api";
import { inr } from "../../lib/format";
import { vendorCatalogSpec } from "../../lib/attrSummary";
import { fileTypeError } from "../../lib/fileValidation";
import { coerceFieldValue, initialFieldValues } from "../../lib/formFields";
import { FormField } from "../../components/FormField";
import { Tag, StateTag } from "../../components/Tag";
import { useModal } from "../../components/useModal";
import type { BidForm, BidRequirements } from "../../lib/types";
import { KIND_LABELS } from "../tenders/AttachmentsPanel";
import { BidAttachmentsPanel } from "./BidAttachmentsPanel";
import { applyForm, bidDetailFields, buildBidPayload, evalSummary, fieldsDisabled, lineDetailsSummary, lineTotal, rowFromForm, rowResolved, type BidRow } from "./bidRow";
import { buildTemplateCsv, downloadTextFile, importCsvRows } from "./bidLineItemsCsv";

// Ported 1:1 from frontend/js/pages/bid/bidLineItems.js -- the vendor bid
// workspace for one tender: same spreadsheet-grid pattern as tender
// line-item creation, core commercial fields editable straight in the grid
// (or pasted/CSV-imported from Excel), technical answers + compliance +
// attachments behind a per-row "Details" expansion. Unlike the tender
// grid, a vendor can't add or remove rows: the line set is fixed by which
// lines they were invited to bid on.
export interface GateInfo {
  title: string;
  body: string;
  submitDisabled: boolean;
  isSubmitted: boolean;
  hasRows: boolean;
}

export interface BidLineItemsGridHandle {
  getRows: () => BidRow[];
  loadRows: (forms: BidForm[]) => void;
  saveAllDrafts: () => Promise<{ message: string; ok: boolean }>;
  submitBid: () => Promise<{ message: string; ok: boolean } | null>;
  reopenBid: () => Promise<{ message: string; ok: boolean } | null>;
  downloadTemplate: () => void;
  applyCsvImport: (text: string) => string[];
  gateInfo: () => GateInfo;
}

// Live hint only (spec 8.2 Asset distributor rule): while the vendor has
// just ticked "Bidding as a distributor" but hasn't saved/reloaded yet, the
// manufacturer-authorization slot should already read as required -- the
// mandatory tag is recomputed for real from the saved bid's details on the
// next render either way, same as vanilla's comment on this. Derived here
// (recomputes every render from live `details` state) rather than a manual
// DOM patch, which is what the vanilla version needed instead.
function effectiveRequirements(row: BidRow): BidRequirements {
  if (row.procurement_type !== "asset" || row.details.bidding_as_distributor !== true) return row.requirements;
  const already = row.attachments.some((a) => a.kind === "manufacturer_authorization");
  if (already) return row.requirements;
  const slots = row.requirements.slots.map((s) => (s.kind === "manufacturer_authorization" ? { ...s, mandatory: true } : s));
  return { ...row.requirements, slots };
}

export const BidLineItemsGrid = forwardRef<BidLineItemsGridHandle, { tenderId: number; onChange: () => void }>(function BidLineItemsGrid({ tenderId, onChange }, ref) {
  const [rows, setRowsState] = useState<BidRow[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  // "<row index>:<kind>" currently mid-upload, if any -- see BidAttachmentsPanel.tsx's own comment.
  const [busyAttachment, setBusyAttachment] = useState<string | null>(null);
  const [attachmentProgress, setAttachmentProgress] = useState(0);
  const { confirmAsync, modalElement } = useModal();

  const setRows = (next: BidRow[]) => {
    setRowsState(next);
    onChange();
  };
  const updateRow = (i: number, fn: (row: BidRow) => BidRow) => setRows(rows.map((r, idx) => (idx === i ? fn(r) : r)));

  // Reads the Details expansion's fields back into the row -- there's no
  // DOM to flush in React (every field is already a controlled input
  // committed immediately), so this is a no-op kept only so the rest of
  // this port's control flow (which calls it at the same points vanilla
  // did, before any save) doesn't need restructuring.
  const flushAllExpanded = () => {};

  useImperativeHandle(ref, () => ({
    getRows: () => rows,
    // Called by the parent right after it fetches TenderBids -- builds every
    // row fresh from its BidFormOut, same as vanilla's setFromServer() (the
    // tenderCtx half of that function lives in BidPage.tsx instead, since
    // that's not something this grid needs to know about).
    loadRows: (forms) => {
      setExpandedRows(new Set());
      setRowsState(forms.map((f) => ({ ...rowFromForm(f), skipped: false })));
    },
    gateInfo: (): GateInfo => {
      const isSubmitted = rows.some((r) => r.status === "submitted");
      if (isSubmitted) {
        return { title: "Bid submitted", body: "Your bid for this tender has been submitted. Use Reopen for editing if you need to change something before the deadline.", submitDisabled: true, isSubmitted, hasRows: rows.length > 0 };
      }
      if (!rows.length) {
        return { title: "Nothing to bid on", body: "There are no lines to bid on in this tender.", submitDisabled: true, isSubmitted, hasRows: false };
      }
      const unresolved = rows.filter((r) => !rowResolved(r));
      if (unresolved.length) {
        return {
          title: "Not ready to submit",
          body: `${unresolved.length} line(s) still need an answer — fill them in or mark them Skip: ${unresolved.map((r) => r.product_name).join(", ")}`,
          submitDisabled: true,
          isSubmitted,
          hasRows: true,
        };
      }
      return {
        title: "Ready to submit",
        body: "Every line has been answered (bid or skipped). Reopen for editing is available before the deadline if you need to change something after submitting.",
        submitDisabled: false,
        isSubmitted,
        hasRows: true,
      };
    },
    saveAllDrafts: async () => {
      flushAllExpanded();
      setExpandedRows(new Set());
      const candidates = rows.filter((r) => !r.locked && !r.skipped && r.status !== "submitted");
      if (!candidates.length) return { message: "Nothing to save.", ok: true };
      const payload = { lines: candidates.map((r) => ({ line_item_id: r.line_item_id, ...buildBidPayload(r), submit: false })) };
      try {
        const results = await api<{ line_item_id: number; ok: boolean; error: string | null; form: BidForm | null }[]>(`/vendor-portal/bids/tender/${tenderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const byId = new Map(results.map((r) => [r.line_item_id, r]));
        const errors: string[] = [];
        const next = rows.map((row) => {
          const res = byId.get(row.line_item_id);
          if (!res) return row;
          if (res.ok && res.form) return applyForm(row, res.form);
          if (!res.ok) errors.push(`${row.product_name}: ${res.error}`);
          return row;
        });
        setRows(next);
        const okCount = results.filter((r) => r.ok).length;
        return errors.length
          ? { message: `${okCount} line(s) saved. ${errors.length} line(s) could not be saved: ${errors.join("; ")}`, ok: false }
          : { message: `${okCount} line(s) saved as draft.`, ok: true };
      } catch (err) {
        return { message: "Could not save: " + (err instanceof Error ? err.message : String(err)), ok: false };
      }
    },
    submitBid: async () => {
      flushAllExpanded();
      const candidates = rows.filter((r) => !r.locked && !r.skipped && r.status !== "submitted");
      if (!candidates.length) return { message: "Nothing to submit.", ok: false };
      const ok = await confirmAsync(
        "Submit your bid for this tender? This covers every line you've filled in — skipped lines are left out. You can use Reopen for editing before the deadline if you need to change something.",
        { title: "Submit Bid", confirmLabel: "Submit" }
      );
      if (!ok) return null;
      const payload = { lines: candidates.map((r) => ({ line_item_id: r.line_item_id, ...buildBidPayload(r), submit: true })) };
      try {
        const results = await api<{ line_item_id: number; ok: boolean; error: string | null; form: BidForm | null }[]>(`/vendor-portal/bids/tender/${tenderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const byId = new Map(results.map((r) => [r.line_item_id, r]));
        const errors: string[] = [];
        const next = rows.map((row) => {
          const res = byId.get(row.line_item_id);
          if (!res) return row;
          if (res.ok && res.form) return applyForm(row, res.form);
          if (!res.ok) errors.push(`${row.product_name}: ${res.error}`);
          return row;
        });
        setRows(next);
        return errors.length ? { message: `Could not submit: ${errors.join("; ")}`, ok: false } : { message: "Bid submitted.", ok: true };
      } catch (err) {
        return { message: "Could not submit: " + (err instanceof Error ? err.message : String(err)), ok: false };
      }
    },
    reopenBid: async () => {
      const ok = await confirmAsync("Reopen this bid for editing? Every submitted line goes back to draft — you'll need to submit again before the deadline.", {
        title: "Reopen for Editing",
        confirmLabel: "Reopen",
        danger: true,
      });
      if (!ok) return null;
      try {
        const forms = await api<BidForm[]>(`/vendor-portal/bids/tender/${tenderId}/reopen`, { method: "POST" });
        const byId = new Map(forms.map((f) => [f.context.line_item_id, f]));
        setRows(rows.map((row) => {
          const f = byId.get(row.line_item_id);
          return f ? applyForm(row, f) : row;
        }));
        return { message: "Bid reopened for editing.", ok: true };
      } catch (err) {
        return { message: "Could not reopen: " + (err instanceof Error ? err.message : String(err)), ok: false };
      }
    },
    downloadTemplate: () => {
      flushAllExpanded();
      downloadTextFile("bid-lines-template.csv", buildTemplateCsv(rows));
    },
    applyCsvImport: (text: string) => {
      const { updates, errors } = importCsvRows(text, rows);
      setRows(
        rows.map((row) => {
          const patch = updates.get(String(row.line_item_id));
          // payment_terms/brand_offered/technical_compliance can come back
          // null from a blank CSV cell (same as a vendor clearing the
          // field by hand) -- normalized to "" here so BidRow's own shape
          // (always a string, never null, matching rowFromForm) holds for
          // every row regardless of where its values came from.
          return patch
            ? { ...row, ...patch, payment_terms: patch.payment_terms ?? "", brand_offered: patch.brand_offered ?? "", technical_compliance: patch.technical_compliance ?? "" }
            : row;
        })
      );
      return errors;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }));

  // ---- Attachments ----
  const ensureBidSaved = async (i: number): Promise<number> => {
    const row = rows[i];
    if (row.bid_id != null) return row.bid_id;
    const body = { ...buildBidPayload(row), submit: false };
    const form = await api<BidForm>(`/vendor-portal/bids/line/${row.line_item_id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return new Promise((resolve, reject) => {
      setRowsState((current) => {
        const updated = applyForm(current[i], form);
        const next = current.map((r, idx) => (idx === i ? updated : r));
        if (updated.bid_id == null) reject(new Error("Could not save this bid line — try again."));
        else resolve(updated.bid_id);
        return next;
      });
    });
  };

  const uploadAttachment = async (i: number, kind: string) => {
    if (busyAttachment === `${i}:${kind}`) return;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".pdf,.docx,.xlsx,.jpg,.jpeg,.png";
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      // Real bug, found 2026-10-13: `accept=` above is just a picker hint
      // ("All files" overrides it), and nothing ever actually checked the
      // picked file before sending it -- a disallowed type/oversized file
      // only got rejected by the backend's own document_store.validate(),
      // after the upload round-trip. See lib/fileValidation.ts.
      const typeErr = fileTypeError(file, { allowOffice: true });
      if (typeErr) {
        window.alert(typeErr);
        return;
      }
      setBusyAttachment(`${i}:${kind}`);
      setAttachmentProgress(0);
      try {
        const id = rows[i].bid_id ?? (await ensureBidSaved(i));
        const fd = new FormData();
        fd.append("kind", kind);
        fd.append("file", file);
        await uploadWithProgress(`/vendor-portal/bids/${id}/attachments`, fd, setAttachmentProgress);
        const form = await api<BidForm>(`/vendor-portal/bids/line/${rows[i].line_item_id}`);
        updateRow(i, (r) => applyForm(r, form));
      } catch (err) {
        window.alert("Could not upload: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setBusyAttachment(null);
      }
    });
    picker.click();
  };

  const removeAttachment = async (i: number, attachmentId: number) => {
    try {
      await api(`/vendor-portal/bids/${rows[i].bid_id}/attachments/${attachmentId}`, { method: "DELETE" });
      const form = await api<BidForm>(`/vendor-portal/bids/line/${rows[i].line_item_id}`);
      updateRow(i, (r) => applyForm(r, form));
    } catch (err) {
      window.alert("Could not remove: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const viewAttachment = async (bidId: number, attachmentId: number) => {
    try {
      const res = await fetch(`${API_BASE}/vendor-portal/bids/${bidId}/attachments/${attachmentId}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  const viewSpecAttachment = async (lineItemId: number, attachmentId: number) => {
    try {
      const res = await fetch(`${API_BASE}/vendor-portal/bids/line/${lineItemId}/spec-attachments/${attachmentId}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  // ---- Flat-grid field edits ----
  const onNumericInput = (i: number, field: string, value: string) => updateRow(i, (r) => ({ ...r, [field]: value === "" ? null : Number(value) }));
  const onTextInput = (i: number, field: "payment_terms", value: string) => updateRow(i, (r) => ({ ...r, [field]: value }));
  const toggleSkip = (i: number, checked: boolean) => setRows(rows.map((r, idx) => (idx === i ? { ...r, skipped: checked } : r)));
  const toggleDetails = (i: number) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // ---- Details expansion edits ----
  const updateDetailField = (i: number, fieldName: string, value: string, kind: string) =>
    updateRow(i, (r) => {
      const coerced = coerceFieldValue({ name: fieldName, label: "", kind: kind as never }, value);
      const nextDetails = { ...r.details };
      if (coerced === undefined) delete nextDetails[fieldName];
      else nextDetails[fieldName] = coerced;
      return { ...r, details: nextDetails };
    });
  const setBrandOffered = (i: number, value: string) => updateRow(i, (r) => ({ ...r, brand_offered: value }));
  const setCompliantFull = (i: number, checked: boolean) => updateRow(i, (r) => ({ ...r, compliant_full: checked }));
  const setTechnicalCompliance = (i: number, value: string) => updateRow(i, (r) => ({ ...r, technical_compliance: value }));
  const setComments = (i: number, value: string) => updateRow(i, (r) => ({ ...r, comments: value }));

  return (
    <div>
      <div className="li-grid-wrap">
        <table className="ep-table li-grid">
          <thead>
            <tr>
              {["#", "Product", "Qty", "Status", "Unit Price (₹)", "GST %", "Other Duties", "Lead (d)", "Validity (d)", "Payment Terms", "Landed Total", ""].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td className="ep-cell hint" colSpan={12}>
                  No lines you're invited to bid on in this tender.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const total = lineTotal(row);
                const expanded = expandedRows.has(i);
                const disabled = fieldsDisabled(row);
                const fields = bidDetailFields(row);
                const detailsRaw = initialFieldValues(fields, row.details);
                const showBrand = row.procurement_type !== "service";
                const req = effectiveRequirements(row);
                return (
                  <Fragment key={row.line_item_id}>
                    <tr className="li-row">
                      <td className="ep-cell li-rownum">{i + 1}</td>
                      <td className="ep-cell li-product-name">
                        {row.product_name} <span className="ep-sub">{row.procurement_type}</span>
                      </td>
                      <td className="ep-cell">
                        {row.qty}
                        {row.uom ? " " + row.uom : ""}
                      </td>
                      <td className="ep-cell">{row.skipped ? <Tag text="Skipped" /> : row.status ? <StateTag state={row.status} /> : <Tag text="Not started" tone="att" />}</td>
                      <td className="ep-cell">
                        <input className="input" type="number" step="any" min={0} disabled={disabled} value={row.unit_price ?? ""} onChange={(e) => onNumericInput(i, "unit_price", e.target.value)} />
                      </td>
                      <td className="ep-cell">
                        <input className="input" type="number" step="any" min={0} disabled={disabled} value={row.gst_percent ?? ""} onChange={(e) => onNumericInput(i, "gst_percent", e.target.value)} />
                      </td>
                      <td className="ep-cell">
                        <input className="input" type="number" step="any" min={0} disabled={disabled} value={row.other_duties ?? ""} onChange={(e) => onNumericInput(i, "other_duties", e.target.value)} />
                      </td>
                      <td className="ep-cell">
                        <input
                          className="input"
                          type="number"
                          step="any"
                          min={0}
                          disabled={disabled}
                          value={row.delivery_lead_days ?? ""}
                          onChange={(e) => onNumericInput(i, "delivery_lead_days", e.target.value)}
                        />
                      </td>
                      <td className="ep-cell">
                        <input
                          className="input"
                          type="number"
                          step="any"
                          min={0}
                          disabled={disabled}
                          value={row.quote_validity_days ?? ""}
                          onChange={(e) => onNumericInput(i, "quote_validity_days", e.target.value)}
                        />
                      </td>
                      <td className="ep-cell">
                        <input className="input" type="text" disabled={disabled} value={row.payment_terms || ""} onChange={(e) => onTextInput(i, "payment_terms", e.target.value)} />
                      </td>
                      <td className="ep-cell li-total">{total ? inr(total) : "—"}</td>
                      <td className="ep-cell nowrap">
                        <button type="button" className="ep-b li-details-btn" onClick={() => toggleDetails(i)}>
                          {expanded ? "Hide" : "Details"}
                        </button>
                        <label className="ep-switch mr-8px nowrap">
                          <input type="checkbox" checked={row.skipped} disabled={row.locked || row.status === "submitted"} onChange={(e) => toggleSkip(i, e.target.checked)} />
                          <span className="ep-switch-track">
                            <span className="ep-switch-knob"></span>
                          </span>
                          <span className="ep-switch-label">Skip</span>
                        </label>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="li-details-row">
                        <td className="ep-cell" colSpan={12}>
                          {row.lock_reason && <div className="ep-note warn mb-10px">{row.lock_reason}</div>}
                          <div className="hint mb-6px">
                            <b>Catalog spec (reference):</b> {vendorCatalogSpec(row.catalog_spec)}
                          </div>
                          <div className="hint mb-6px">
                            <b>For this tender:</b> {lineDetailsSummary(row)}
                          </div>
                          <div className="hint mb-14px">
                            <b>Evaluation:</b> {evalSummary(row)}
                          </div>
                          <div className="ep-k mb-6px">Documents provided (spec §6.4)</div>
                          <div className="mb-16px">
                            {!row.spec_attachments?.length ? (
                              <div className="hint">No documents attached to this line.</div>
                            ) : (
                              <div className="d-flex flex-col gap-6px">
                                {row.spec_attachments.map((a) => (
                                  <div className="d-flex gap-10px items-center fs-12-5px" key={a.id}>
                                    <span className="ep-tag">{KIND_LABELS[a.kind] || a.kind}</span>
                                    <a
                                      href="#"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        viewSpecAttachment(row.line_item_id, a.id);
                                      }}
                                    >
                                      {a.custom_label || a.original_filename}
                                    </a>
                                    <span className="ep-sub">{(a.size_bytes / 1024).toFixed(0)} KB</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {showBrand && (
                            <div className="ep-field kit-field maxw-340px mb-12px">
                              <div className="ep-k">Brand / model offered</div>
                              <input className="input" disabled={disabled} value={row.brand_offered || ""} onChange={(e) => setBrandOffered(i, e.target.value)} />
                            </div>
                          )}
                          {fields.length > 0 && (
                            <div className="line-details-fields d-grid grid-cols-repeat31fr gap-10px-16px">
                              {fields.map((f) => (
                                <FormField key={f.name} field={f} raw={detailsRaw} onChange={(name, value) => updateDetailField(i, name, value, f.kind)} />
                              ))}
                            </div>
                          )}
                          <div className="ep-field mt-14px">
                            <label className="ep-check">
                              <input type="checkbox" disabled={disabled} checked={row.compliant_full} onChange={(e) => setCompliantFull(i, e.target.checked)} /> Meets the specification
                              fully — no deviations{row.requirements.compliance_required ? " *" : ""}
                            </label>
                          </div>
                          {!row.compliant_full && (
                            <div className="ep-field">
                              <div className="ep-k">
                                What is not compliant / deviations from the specification{row.requirements.required_fields.includes("technical_compliance") ? " *" : ""}
                              </div>
                              <textarea
                                className="input w-full resize-y"
                                rows={3}
                                disabled={disabled}
                                value={row.technical_compliance || ""}
                                onChange={(e) => setTechnicalCompliance(i, e.target.value)}
                              />
                            </div>
                          )}
                          <div className="ep-field mt-14px">
                            <div className="ep-k">Comments (optional)</div>
                            <textarea
                              className="input w-full resize-y"
                              rows={3}
                              placeholder="Anything else you'd like to add for this line"
                              disabled={disabled}
                              value={row.comments || ""}
                              onChange={(e) => setComments(i, e.target.value)}
                            />
                          </div>
                          <div className="ep-k mt-16px mb-6px">Attachments (spec §8.3)</div>
                          <BidAttachmentsPanel
                            attachments={row.attachments}
                            req={req}
                            locked={disabled}
                            busyKind={busyAttachment?.startsWith(`${i}:`) ? busyAttachment.slice(`${i}:`.length) : null}
                            busyProgress={attachmentProgress}
                            onUpload={(kind) => uploadAttachment(i, kind)}
                            onRemove={(attId) => removeAttachment(i, attId)}
                            onView={(attId) => row.bid_id != null && viewAttachment(row.bid_id, attId)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {modalElement}
    </div>
  );
});
