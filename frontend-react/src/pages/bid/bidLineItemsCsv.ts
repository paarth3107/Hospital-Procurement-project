import type { FieldDef } from "../../lib/formFields";
import { downloadTextFile, parseBool, parseCsvText } from "../tenders/lineItemsCsv";
import { BID_DETAIL_FIELDS_BY_TYPE } from "./bidFields";
import type { BidRow } from "./bidRow";

// Ported 1:1 from frontend/js/pages/bid/bidLineItemsCsv.js -- CSV bulk fill
// for a vendor's bid lines, mirroring the tender line-item CSV pattern --
// but a vendor can't add or remove lines the way an officer creating a
// tender can: the line set is fixed by which lines they were invited to
// bid on. So there's no catalog to type a product code against; instead
// the template is generated FROM the vendor's own current grid (one row
// per line they're invited on, pre-filled with whatever they've already
// entered), and import matches rows back by line_item_id -- unambiguous,
// unlike product code, which nothing stops a tender from repeating across
// two lines. product_name rides along only as a human-readable check,
// never used for matching. Reuses tenders/lineItemsCsv.ts's parseCsvText/
// downloadTextFile/parseBool -- same RFC4180-ish parser, no need to
// duplicate it.
export { downloadTextFile, parseBool };

export const CORE_COLUMNS = [
  "line_item_id",
  "product_name",
  "unit_price",
  "gst_percent",
  "other_duties",
  "delivery_lead_days",
  "quote_validity_days",
  "payment_terms",
  "brand_offered",
  "compliant_full",
  "technical_compliance",
] as const;

// Every type-specific detail field, deduped by name, across all three types
// -- a row that doesn't need a given type's field just leaves that column
// blank.
export const DETAIL_FIELDS: FieldDef[] = (() => {
  const seen = new Map<string, FieldDef>();
  for (const type of ["item", "asset", "service"] as const) {
    for (const f of BID_DETAIL_FIELDS_BY_TYPE[type]) if (!seen.has(f.name)) seen.set(f.name, f);
  }
  return [...seen.values()];
})();

export const CSV_HEADERS = [...CORE_COLUMNS, ...DETAIL_FIELDS.map((f) => f.name)];

function toCsvField(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Exports the vendor's OWN current rows (not a blank example) -- filling in
// Excel and re-uploading is meant to be a round trip against real lines.
export function buildTemplateCsv(rows: BidRow[]): string {
  const rowsOut = rows.map((row) => {
    const cells: Record<string, string> = {
      line_item_id: String(row.line_item_id),
      product_name: row.product_name,
      unit_price: row.unit_price != null ? String(row.unit_price) : "",
      gst_percent: row.gst_percent != null ? String(row.gst_percent) : "",
      other_duties: row.other_duties != null ? String(row.other_duties) : "",
      delivery_lead_days: row.delivery_lead_days != null ? String(row.delivery_lead_days) : "",
      quote_validity_days: row.quote_validity_days != null ? String(row.quote_validity_days) : "",
      payment_terms: row.payment_terms ?? "",
      brand_offered: row.brand_offered ?? "",
      compliant_full: row.compliant_full ? "true" : "false",
      technical_compliance: row.technical_compliance ?? "",
    };
    for (const f of DETAIL_FIELDS) {
      const v = row.details?.[f.name];
      cells[f.name] = f.kind === "bool" ? (v === true ? "true" : v === false ? "false" : "") : v != null ? String(v) : "";
    }
    return CSV_HEADERS.map((h) => cells[h] ?? "");
  });
  return [CSV_HEADERS, ...rowsOut].map((r) => r.map(toCsvField).join(",")).join("\r\n") + "\r\n";
}

function coerceDetailField(f: FieldDef, raw: string, errors: string[], rowNumber: number): unknown {
  const v = raw.trim();
  if (v === "") return undefined;
  if (f.kind === "number") {
    const n = Number(v);
    if (Number.isNaN(n)) {
      errors.push(`Row ${rowNumber}: "${f.label}" must be a number`);
      return undefined;
    }
    return n;
  }
  if (f.kind === "bool") return parseBool(v);
  return v; // text / textarea
}

export interface BidRowPatch {
  unit_price: number | null;
  gst_percent: number | null;
  other_duties: number | null;
  delivery_lead_days: number | null;
  quote_validity_days: number | null;
  payment_terms: string | null;
  brand_offered: string | null;
  compliant_full: boolean;
  technical_compliance: string | null;
  details: Record<string, unknown>;
}

// Parses the uploaded file against the vendor's currently loaded rows.
// Returns { updates, errors }: updates is a map of line_item_id (string) ->
// partial row patch, ready to apply onto the matching row; errors is a
// per-row-number list for anything that couldn't be applied -- the rows
// that did parse are still applied (partial import, matching the tender
// CSV's own "fix and re-upload just the bad ones" pattern).
export function importCsvRows(text: string, rows: BidRow[]): { updates: Map<string, BidRowPatch>; errors: string[] } {
  const byId = new Map(rows.map((r) => [String(r.line_item_id), r]));
  const table = parseCsvText(text);
  if (!table.length) return { updates: new Map(), errors: ["The file is empty."] };

  const header = table[0].map((h) => h.trim());
  const colIndex = new Map(header.map((h, i) => [h, i]));
  if (!colIndex.has("line_item_id")) {
    return { updates: new Map(), errors: ['Missing required column "line_item_id" -- download the template from this same page and fill it in rather than building the file from scratch.'] };
  }

  const updates = new Map<string, BidRowPatch>();
  const errors: string[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => c.trim() === "")) continue;
    const rowNumber = r + 1;
    const get = (col: string) => (colIndex.has(col) ? cells[colIndex.get(col)!] ?? "" : "");
    const rowErrors: string[] = [];

    const lineId = get("line_item_id").trim();
    const row = byId.get(lineId);
    if (!lineId) rowErrors.push(`Row ${rowNumber}: line_item_id is required`);
    else if (!row) rowErrors.push(`Row ${rowNumber}: line_item_id ${lineId} isn't one of your invited lines in this tender`);

    const numField = (col: string, label: string, opts: { min?: number | null; allowNegative?: boolean } = {}): number | null => {
      const { min = null, allowNegative = false } = opts;
      const raw = get(col).trim();
      if (raw === "") return null;
      const n = Number(raw);
      if (Number.isNaN(n) || (!allowNegative && n < 0) || (min != null && n < min)) rowErrors.push(`Row ${rowNumber}: "${label}" is invalid`);
      return n;
    };

    const unitPrice = numField("unit_price", "Unit price");
    const gstPercent = numField("gst_percent", "GST %");
    const otherDuties = numField("other_duties", "Other duties");
    const deliveryLeadDays = numField("delivery_lead_days", "Delivery lead time (days)");
    const quoteValidityDays = numField("quote_validity_days", "Quote validity (days)");

    const details: Record<string, unknown> = {};
    if (row) {
      for (const f of BID_DETAIL_FIELDS_BY_TYPE[row.procurement_type] || []) {
        const raw = get(f.name);
        if (raw === undefined || raw.trim() === "") continue;
        const value = coerceDetailField(f, raw, rowErrors, rowNumber);
        if (value !== undefined) details[f.name] = value;
      }
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }

    updates.set(lineId, {
      unit_price: unitPrice,
      gst_percent: gstPercent,
      other_duties: otherDuties,
      delivery_lead_days: deliveryLeadDays,
      quote_validity_days: quoteValidityDays,
      payment_terms: get("payment_terms").trim() || null,
      brand_offered: get("brand_offered").trim() || null,
      compliant_full: parseBool(get("compliant_full")),
      technical_compliance: get("technical_compliance").trim() || null,
      details: { ...row!.details, ...details },
    });
  }
  return { updates, errors };
}
