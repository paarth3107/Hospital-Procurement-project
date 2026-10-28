import type { FieldDef } from "../../lib/formFields";
import { LINE_DETAIL_FIELDS_BY_TYPE } from "../tenders/lineDetailFields";
import { BID_DETAIL_FIELDS_BY_TYPE } from "./bidFields";
import type { BidAttachment, BidForm, BidRequirements, BidSavePayload, BidStatus, CatalogSpec, LineAttachment, ProcurementType, TechnicalEvalMethod } from "../../lib/types";

// The grid's own in-progress editing shape -- ported from
// frontend/js/pages/bid/bidLineItems.js's rowFromForm()/setFromServer().
// Unlike the tender line-items grid, a vendor can't add or remove rows:
// the line set is fixed by which lines they were invited to bid on, so
// there's no blankRow() here.
export interface BidRow {
  line_item_id: number;
  product_name: string;
  qty: number;
  uom: string | null;
  procurement_type: ProcurementType;
  shelf_life_tracked: boolean;
  technical_eval_method: TechnicalEvalMethod;
  technical_weight: number | null;
  price_weight: number | null;
  split_award_allowed: boolean;
  catalog_spec: CatalogSpec;
  line_details_spec: Record<string, unknown>;
  spec_attachments: LineAttachment[];
  requirements: BidRequirements;
  locked: boolean;
  lock_reason: string | null;
  bid_id: number | null;
  status: BidStatus | null;
  unit_price: number | null;
  gst_percent: number | null;
  other_duties: number | null;
  delivery_lead_days: number | null;
  quote_validity_days: number | null;
  payment_terms: string;
  compliant_full: boolean;
  technical_compliance: string;
  brand_offered: string;
  comments: string;
  details: Record<string, unknown>;
  attachments: BidAttachment[];
  // Local-only (never sent to or received from the server): a line
  // explicitly marked "Skip" is simply left out of the final submit
  // payload, never persisted as its own state.
  skipped: boolean;
}

export function rowFromForm(form: BidForm): Omit<BidRow, "skipped"> {
  const { context: ctx, requirements: req, bid, locked, lock_reason } = form;
  return {
    line_item_id: ctx.line_item_id,
    product_name: ctx.product_name,
    qty: ctx.qty,
    uom: ctx.uom,
    procurement_type: ctx.procurement_type,
    shelf_life_tracked: ctx.shelf_life_tracked,
    technical_eval_method: ctx.technical_eval_method,
    technical_weight: ctx.technical_weight,
    price_weight: ctx.price_weight,
    split_award_allowed: ctx.split_award_allowed,
    catalog_spec: ctx.catalog_spec,
    line_details_spec: ctx.line_details,
    spec_attachments: ctx.attachments,
    requirements: req,
    locked,
    lock_reason,
    bid_id: bid?.id ?? null,
    status: bid?.status ?? null,
    unit_price: bid?.unit_price ?? null,
    gst_percent: bid?.gst_percent ?? null,
    other_duties: bid?.other_duties ?? null,
    delivery_lead_days: bid?.delivery_lead_days ?? null,
    quote_validity_days: bid?.quote_validity_days ?? null,
    payment_terms: bid?.payment_terms ?? "",
    compliant_full: bid?.compliant_full ?? false,
    technical_compliance: bid?.technical_compliance ?? "",
    brand_offered: bid?.brand_offered ?? "",
    comments: bid?.comments ?? "",
    details: bid?.details ?? {},
    attachments: bid?.attachments ?? [],
  };
}

// "skipped" is local-only -- preserved explicitly since rowFromForm() only
// knows about server-derived fields.
export function applyForm(row: BidRow, form: BidForm): BidRow {
  return { ...rowFromForm(form), skipped: row.skipped };
}

export const landedUnitPrice = (row: BidRow): number | null =>
  row.unit_price != null ? row.unit_price * (1 + (row.gst_percent || 0) / 100) + (row.other_duties || 0) : null;

export const lineTotal = (row: BidRow): number => {
  const l = landedUnitPrice(row);
  return l != null ? l * row.qty : 0;
};

export function bidDetailFields(row: BidRow): FieldDef[] {
  const need = (name: string) => row.requirements.required_fields.includes(`details.${name}`);
  // The standard red Req asterisk (2026-10-28, user-directed), not a
  // literal " *" baked into the label string -- see FormField.tsx.
  return (BID_DETAIL_FIELDS_BY_TYPE[row.procurement_type] || []).map((f) => ({ ...f, required: need(f.name) }));
}

const EVAL_METHOD_LABEL: Record<string, string> = { qualify_disqualify: "Qualify/Disqualify", scored: "Scored technical ranking" };

// "What's being asked" -- read-only reference material a vendor needs
// before bidding: the catalog spec, this tender's own per-line overrides,
// how the line will be evaluated, and the officer's uploaded spec
// documents.
export function evalSummary(row: BidRow): string {
  const bits = [
    row.technical_eval_method === "qcbs" ? `QCBS (Technical ${row.technical_weight}% / Price ${row.price_weight}%)` : EVAL_METHOD_LABEL[row.technical_eval_method] || row.technical_eval_method,
  ];
  if (row.split_award_allowed) bits.push("Split-award allowed — this line's quantity may be divided among more than one vendor");
  return bits.join(" · ");
}

export function lineDetailsSummary(row: BidRow): string {
  const fields = LINE_DETAIL_FIELDS_BY_TYPE[row.procurement_type] || [];
  const bits: string[] = [];
  for (const f of fields) {
    const v = row.line_details_spec?.[f.name] as unknown;
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    bits.push(`${f.label}: ${Array.isArray(v) ? v.join(", ") : f.kind === "bool" ? (v ? "Yes" : "No") : String(v)}`);
  }
  return bits.length ? bits.join(" · ") : "Nothing extra specified for this tender.";
}

export function buildBidPayload(row: BidRow): BidSavePayload {
  return {
    unit_price: row.unit_price,
    gst_percent: row.gst_percent,
    other_duties: row.other_duties,
    delivery_lead_days: row.delivery_lead_days,
    quote_validity_days: row.quote_validity_days,
    payment_terms: (row.payment_terms || "").trim() || null,
    compliant_full: !!row.compliant_full,
    technical_compliance: row.compliant_full ? null : (row.technical_compliance || "").trim() || null,
    brand_offered: (row.brand_offered || "").trim() || null,
    comments: (row.comments || "").trim() || null,
    details: row.details || {},
    submit: false, // overridden by the caller (saveAllDrafts: false, submitBid: true)
  };
}

// A line's fields lock once it's been finally submitted (no per-line amend
// -- use Reopen for editing), once it's marked Skip, or for the
// pre-existing locked reasons (deadline passed, tender/line no longer
// open, vendor no longer Active).
export const fieldsDisabled = (row: BidRow): boolean => row.locked || row.status === "submitted" || row.skipped;

// What's still missing for this line to count as "resolved" toward the
// tender-wide submit gate -- mirrors the backend's own submit_problems()
// (app/services/bids.py), close enough for a responsive client-side gate;
// the backend stays the authoritative check on the actual submit call.
// technical_compliance is handled live off row.compliant_full rather than
// trusting req.required_fields, which only reflects state as of the last
// save/load.
export function rowProblems(row: BidRow): string[] {
  const req = row.requirements;
  const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && !v.length);
  const problems: string[] = [];
  for (const f of req.required_fields) {
    if (f === "technical_compliance") continue;
    const v = f.startsWith("details.") ? row.details?.[f.slice("details.".length)] : (row as unknown as Record<string, unknown>)[f];
    if (blank(v)) problems.push(f);
  }
  if (req.compliance_required && !row.compliant_full && blank(row.technical_compliance)) problems.push("technical_compliance");
  const have = new Set((row.attachments || []).map((a) => a.kind));
  for (const s of req.slots) if (s.mandatory && !have.has(s.kind)) problems.push(`attachment:${s.kind}`);
  return problems;
}

export function rowResolved(row: BidRow): boolean {
  if (row.locked || row.skipped || row.status === "submitted") return true;
  return rowProblems(row).length === 0;
}
