import type { FieldDef } from "../../lib/formFields";
import type { CatalogProduct, TechnicalEvalMethod } from "../../lib/types";
import { LINE_DETAIL_FIELDS_BY_TYPE } from "./lineDetailFields";
import { blankRow, type LineItemRow } from "./lineItemRow";

// Ported 1:1 from frontend/js/pages/tenders/lineItemsCsv.js -- CSV bulk
// import for tender line items: a procurement officer filling hundreds of
// lines shouldn't have to click through a panel per line. The template's
// columns are the same 8 core fields the grid shows (Stage 2's
// GRID_COLUMNS -- keep both in sync) plus every type-specific field across
// Item/Asset/Service, unioned once so the template covers all three types
// in one flat sheet. A row that doesn't need a given type's fields just
// leaves those columns blank.
export const EVAL_METHODS: TechnicalEvalMethod[] = ["qualify_disqualify", "scored", "qcbs"];

export const CORE_COLUMNS = [
  "product_code",
  "qty",
  "estimated_price",
  "technical_eval_method",
  "technical_weight",
  "price_weight",
  "split_award_allowed",
  "min_rating_threshold_override",
] as const;

// Every type-specific field, deduped by name (a couple of names, like
// delivery_date, are shared by more than one type with the same meaning).
export const DETAIL_FIELDS: FieldDef[] = (() => {
  const seen = new Map<string, FieldDef>();
  for (const type of ["item", "asset", "service"] as const) {
    for (const f of LINE_DETAIL_FIELDS_BY_TYPE[type]) if (!seen.has(f.name)) seen.set(f.name, f);
  }
  return [...seen.values()];
})();

export const CSV_HEADERS = [...CORE_COLUMNS, ...DETAIL_FIELDS.map((f) => f.name)];

export function parseBool(raw: unknown): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "true" || v === "yes" || v === "y" || v === "1";
}

// A small RFC4180-ish parser -- handles quoted fields, embedded commas,
// embedded newlines, and "" as an escaped quote. Good enough for what Excel
// actually writes; not trying to be a full CSV spec implementation.
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\r") {
      // ignore; \n (bare or following \r) ends the row
    } else if (c === "\n") {
      pushRow();
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function toCsvField(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildTemplateCsv(): string {
  const example: Record<string, string> = {
    product_code: "SURG-GLOVES-001",
    qty: "500",
    estimated_price: "8.5",
    technical_eval_method: "qualify_disqualify",
    split_award_allowed: "false",
  };
  const exampleRow = CSV_HEADERS.map((h) => example[h] ?? "");
  return [CSV_HEADERS, exampleRow].map((r) => r.map(toCsvField).join(",")).join("\r\n") + "\r\n";
}

export function downloadTextFile(filename: string, text: string, mime = "text/csv") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function coerceDetailField(f: FieldDef, raw: string, errors: string[], label: string): unknown {
  const v = raw.trim();
  if (v === "") return undefined;
  if (f.kind === "number") {
    const n = Number(v);
    if (Number.isNaN(n)) {
      errors.push(`${label}: "${f.label}" must be a number`);
      return undefined;
    }
    return n;
  }
  if (f.kind === "bool") return parseBool(v);
  if (f.kind === "list")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (f.kind === "select") {
    const known = (f.options ?? []).map(([val]) => val);
    if (!known.includes(v)) {
      errors.push(`${label}: "${f.label}" must be one of ${known.join(", ")}`);
      return undefined;
    }
    return v;
  }
  if (f.kind === "date") {
    if (Number.isNaN(Date.parse(v))) {
      errors.push(`${label}: "${f.label}" must be a valid date (YYYY-MM-DD)`);
      return undefined;
    }
    return v;
  }
  return v; // text / textarea
}

// A row whose product is already on the tender (either already on the
// grid, or added/updated by an earlier row in this same file) is an UPDATE,
// not a new line -- see importCsvRows below for the full rule.
export interface CsvUpdatePatch {
  product_master_id: number;
  patch: Partial<LineItemRow>;
}

// Parses the whole file against the loaded catalog and against whatever's
// already on the grid (existingRows). Returns brand-new rows ready to
// append, patches to merge onto existing rows, and a per-row-number error
// list for anything that couldn't be resolved -- callers append the new
// rows, apply the patches, and show the rest for the user to fix and
// re-upload (partial import).
//
// User-directed, 2026-10-28: re-uploading a file to correct/adjust a few
// lines should UPDATE those lines, not duplicate them -- a cell with a new
// value changes that field; a cell left BLANK leaves whatever's already on
// the line alone (does not clear it); a cell with a value that's invalid
// or out of range fails the WHOLE row (all-or-nothing -- nothing from that
// row is applied, not even its other, otherwise-valid fields), same as a
// brand-new row's formatting errors already worked. The only field that's
// still unconditionally required is product_code (it's how a row says
// which line it means); qty is only required for a brand-new line -- an
// update can leave it blank to mean "unchanged".
export function importCsvRows(
  text: string,
  products: CatalogProduct[],
  existingRows: LineItemRow[] = [],
): { newRows: LineItemRow[]; updates: CsvUpdatePatch[]; errors: string[] } {
  const byCode = new Map(products.map((p) => [p.code.trim().toLowerCase(), p]));
  const table = parseCsvText(text);
  if (!table.length) return { newRows: [], updates: [], errors: ["The file is empty."] };

  const header = table[0].map((h) => h.trim());
  const colIndex = new Map(header.map((h, i) => [h, i]));
  const missingCols = CORE_COLUMNS.filter((c) => !colIndex.has(c));
  if (missingCols.length) return { newRows: [], updates: [], errors: [`Missing required column(s): ${missingCols.join(", ")}`] };

  // Everything already accounted for, by product -- starts as what's
  // already on the grid, and grows as earlier rows in this same file are
  // accepted, so a second row for a product this file just added is
  // itself treated as an update to THAT row, not a second duplicate.
  const known = new Map<number, LineItemRow>(existingRows.filter((r) => r.product_master_id != null).map((r) => [r.product_master_id as number, r]));

  const newRows: LineItemRow[] = [];
  const updates: CsvUpdatePatch[] = [];
  const errors: string[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => c.trim() === "")) continue; // blank spreadsheet row
    const rowNumber = r + 1; // matches what the user sees as the row number in Excel (header = row 1)
    const get = (col: string) => (colIndex.has(col) ? cells[colIndex.get(col)!] ?? "" : "");
    const rowErrors: string[] = [];

    const code = get("product_code").trim();
    const product = code ? byCode.get(code.toLowerCase()) : null;
    // Identifies the row in error messages -- the product code itself
    // (whatever was typed, whether or not it resolved), not the CSV row
    // number: matching a row number back to the actual spreadsheet is
    // extra work and easy to miscount once header/blank rows are in the
    // mix, where the code is already right there on screen (user-directed,
    // 2026-10-28). Only an entirely blank product_code has nothing to show
    // in its place, so that one still falls back to the row number.
    const label = code ? `Product "${code}"` : `Row ${rowNumber}`;
    if (!code) rowErrors.push(`${label}: product_code is required`);
    else if (!product) rowErrors.push(`${label}: unknown product code`);

    const existing = product ? known.get(product.id) : undefined;
    const isUpdate = !!existing;

    const qtyRaw = get("qty").trim();
    let qty: number | null = isUpdate ? existing!.qty : null;
    if (qtyRaw !== "") {
      const n = Number(qtyRaw);
      if (Number.isNaN(n) || n <= 0) rowErrors.push(`${label}: qty must be a number greater than 0`);
      else qty = n;
    } else if (!isUpdate) {
      rowErrors.push(`${label}: qty must be a number greater than 0`);
    }

    const estimatedPriceRaw = get("estimated_price").trim();
    let estimatedPrice: number | null = isUpdate ? existing!.estimated_price : null;
    if (estimatedPriceRaw !== "") {
      const n = Number(estimatedPriceRaw);
      if (Number.isNaN(n) || n < 0) rowErrors.push(`${label}: estimated_price must be a non-negative number`);
      else estimatedPrice = n;
    }

    const evalRaw = get("technical_eval_method").trim();
    let evalMethod: TechnicalEvalMethod | null = isUpdate ? existing!.technical_eval_method : null;
    if (evalRaw !== "") {
      if (!EVAL_METHODS.includes(evalRaw as TechnicalEvalMethod)) rowErrors.push(`${label}: technical_eval_method must be one of ${EVAL_METHODS.join(", ")}`);
      else evalMethod = evalRaw as TechnicalEvalMethod;
    }

    const techWeightRaw = get("technical_weight").trim();
    const priceWeightRaw = get("price_weight").trim();
    let technicalWeight = isUpdate ? existing!.technical_weight : null;
    let priceWeight = isUpdate ? existing!.price_weight : null;
    if (techWeightRaw !== "") technicalWeight = Number(techWeightRaw);
    if (priceWeightRaw !== "") priceWeight = Number(priceWeightRaw);
    // Checked against the EFFECTIVE (merged) method/weights, same as
    // firstRowProblem()'s submit-time check -- correct whether the qcbs-ness
    // or the weights came from this row or were already on the line.
    if (evalMethod === "qcbs" && (!(technicalWeight! > 0) || !(priceWeight! > 0))) {
      rowErrors.push(`${label}: technical_weight and price_weight are both required (and > 0) for QCBS`);
    }

    const minRatingRaw = get("min_rating_threshold_override").trim();
    let minRating: number | null = isUpdate ? existing!.min_rating_threshold_override : null;
    if (minRatingRaw !== "") {
      const n = Number(minRatingRaw);
      if (Number.isNaN(n) || n < 0 || n > 100) rowErrors.push(`${label}: min_rating_threshold_override must be between 0 and 100`);
      else minRating = n;
    }

    // A blank cell here reads as false via parseBool already -- fine for a
    // brand-new row (that's the real default), wrong for an update (would
    // silently turn Split-Award back off); only overwrite when the cell
    // actually has something in it.
    const splitRaw = get("split_award_allowed").trim();
    const splitAward = splitRaw === "" ? (isUpdate ? !!existing!.split_award_allowed : false) : parseBool(splitRaw);

    // Merged onto the existing line's details (blank cell = leave whatever
    // key's already there), not wholesale-replaced.
    const lineDetails: Record<string, unknown> = isUpdate ? { ...(existing!.line_details || {}) } : {};
    if (product) {
      for (const f of LINE_DETAIL_FIELDS_BY_TYPE[product.procurement_type] || []) {
        const raw = get(f.name);
        if (raw === undefined || raw.trim() === "") continue;
        const value = coerceDetailField(f, raw, rowErrors, label);
        if (value !== undefined) lineDetails[f.name] = value;
      }
    }

    if (rowErrors.length) {
      // All-or-nothing: an invalid/out-of-range value anywhere in the row
      // means nothing from it is applied, not even its other fields --
      // same guarantee a brand-new row's formatting errors already had.
      errors.push(...rowErrors);
      continue;
    }

    const fields = {
      qty, estimated_price: estimatedPrice, technical_eval_method: evalMethod, technical_weight: technicalWeight,
      price_weight: priceWeight, split_award_allowed: splitAward, min_rating_threshold_override: minRating, line_details: lineDetails,
    };
    if (isUpdate) {
      updates.push({ product_master_id: product!.id, patch: fields });
      known.set(product!.id, { ...existing!, ...fields }); // a later row for the same product in this file merges against this one, not the original
    } else {
      const row: LineItemRow = { ...blankRow(), product_master_id: product!.id, product_code_input: product!.code, ...fields };
      newRows.push(row);
      known.set(product!.id, row);
    }
  }
  return { newRows, updates, errors };
}
