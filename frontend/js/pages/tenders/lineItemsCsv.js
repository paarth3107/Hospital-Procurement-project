import { LINE_DETAIL_FIELDS_BY_TYPE } from "./lineDetailFields.js";

// ---- CSV bulk import for tender line items (2026-09-30): a procurement
// officer filling hundreds of lines shouldn't have to click through a panel
// per line. The template's columns are the same 8 core fields the grid shows
// (see tenderLineItems.js's GRID_COLUMNS -- keep both in sync) plus every
// type-specific field across Item/Asset/Service, unioned once so the
// template covers all three types in one flat sheet. A row that doesn't
// need a given type's fields just leaves those columns blank. ----

export const EVAL_METHODS = ["qualify_disqualify", "scored", "qcbs"];

export const CORE_COLUMNS = [
  "product_code",
  "qty",
  "estimated_price",
  "technical_eval_method",
  "technical_weight",
  "price_weight",
  "split_award_allowed",
  "min_rating_threshold_override",
];

// Every type-specific field, deduped by name (a couple of names, like
// delivery_date, are shared by more than one type with the same meaning).
export const DETAIL_FIELDS = (() => {
  const seen = new Map();
  for (const type of ["item", "asset", "service"]) {
    for (const f of LINE_DETAIL_FIELDS_BY_TYPE[type]) if (!seen.has(f.name)) seen.set(f.name, f);
  }
  return [...seen.values()];
})();

export const CSV_HEADERS = [...CORE_COLUMNS, ...DETAIL_FIELDS.map((f) => f.name)];

export function parseBool(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "true" || v === "yes" || v === "y" || v === "1";
}

// A small RFC4180-ish parser -- handles quoted fields, embedded commas,
// embedded newlines, and "" as an escaped quote. Good enough for what Excel
// actually writes; not trying to be a full CSV spec implementation.
export function parseCsvText(text) {
  const rows = [];
  let row = [];
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

function toCsvField(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildTemplateCsv() {
  const example = {
    product_code: "SURG-GLOVES-001",
    qty: "500",
    estimated_price: "8.5",
    technical_eval_method: "qualify_disqualify",
    split_award_allowed: "false",
  };
  const exampleRow = CSV_HEADERS.map((h) => example[h] ?? "");
  return [CSV_HEADERS, exampleRow].map((r) => r.map(toCsvField).join(",")).join("\r\n") + "\r\n";
}

export function downloadTextFile(filename, text, mime = "text/csv") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function coerceDetailField(f, raw, errors, rowNumber) {
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
  if (f.kind === "list") return v.split(",").map((s) => s.trim()).filter(Boolean);
  if (f.kind === "select") {
    const known = f.options.map(([val]) => val);
    if (!known.includes(v)) {
      errors.push(`Row ${rowNumber}: "${f.label}" must be one of ${known.join(", ")}`);
      return undefined;
    }
    return v;
  }
  if (f.kind === "date") {
    if (Number.isNaN(Date.parse(v))) {
      errors.push(`Row ${rowNumber}: "${f.label}" must be a valid date (YYYY-MM-DD)`);
      return undefined;
    }
    return v;
  }
  return v; // text / textarea
}

// Parses the whole file against the loaded catalog. Returns validated rows
// ready to append to the grid (blankRow-shaped) plus a per-row-number error
// list for anything that couldn't be resolved -- callers append the good
// rows immediately and show the rest for the user to fix and re-upload
// (partial import, user-directed 2026-09-30).
export function importCsvRows(text, products) {
  const byCode = new Map(products.map((p) => [p.code.trim().toLowerCase(), p]));
  const table = parseCsvText(text);
  if (!table.length) return { rows: [], errors: ["The file is empty."] };

  const header = table[0].map((h) => h.trim());
  const colIndex = new Map(header.map((h, i) => [h, i]));
  const missingCols = CORE_COLUMNS.filter((c) => !colIndex.has(c));
  if (missingCols.length) return { rows: [], errors: [`Missing required column(s): ${missingCols.join(", ")}`] };

  const rows = [];
  const errors = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.every((c) => c.trim() === "")) continue; // blank spreadsheet row
    const rowNumber = r + 1; // matches what the user sees as the row number in Excel (header = row 1)
    const get = (col) => (colIndex.has(col) ? (cells[colIndex.get(col)] ?? "") : "");
    const rowErrors = [];

    const code = get("product_code").trim();
    const product = code ? byCode.get(code.toLowerCase()) : null;
    if (!code) rowErrors.push(`Row ${rowNumber}: product_code is required`);
    else if (!product) rowErrors.push(`Row ${rowNumber}: unknown product code "${code}"`);

    const qty = Number(get("qty"));
    if (!get("qty").trim() || Number.isNaN(qty) || qty <= 0) rowErrors.push(`Row ${rowNumber}: qty must be a number greater than 0`);

    const estimatedPriceRaw = get("estimated_price").trim();
    let estimatedPrice = null;
    if (estimatedPriceRaw !== "") {
      estimatedPrice = Number(estimatedPriceRaw);
      if (Number.isNaN(estimatedPrice) || estimatedPrice < 0) rowErrors.push(`Row ${rowNumber}: estimated_price must be a non-negative number`);
    }

    const evalRaw = get("technical_eval_method").trim();
    let evalMethod = null;
    if (evalRaw !== "") {
      if (!EVAL_METHODS.includes(evalRaw)) rowErrors.push(`Row ${rowNumber}: technical_eval_method must be one of ${EVAL_METHODS.join(", ")}`);
      else evalMethod = evalRaw;
    }

    const techWeightRaw = get("technical_weight").trim();
    const priceWeightRaw = get("price_weight").trim();
    let technicalWeight = techWeightRaw === "" ? null : Number(techWeightRaw);
    let priceWeight = priceWeightRaw === "" ? null : Number(priceWeightRaw);
    if (evalMethod === "qcbs" && (!(technicalWeight > 0) || !(priceWeight > 0))) {
      rowErrors.push(`Row ${rowNumber}: technical_weight and price_weight are both required (and > 0) for QCBS`);
    }

    const minRatingRaw = get("min_rating_threshold_override").trim();
    let minRating = null;
    if (minRatingRaw !== "") {
      minRating = Number(minRatingRaw);
      if (Number.isNaN(minRating) || minRating < 0 || minRating > 100) rowErrors.push(`Row ${rowNumber}: min_rating_threshold_override must be between 0 and 100`);
    }

    const lineDetails = {};
    if (product) {
      for (const f of LINE_DETAIL_FIELDS_BY_TYPE[product.procurement_type] || []) {
        const raw = get(f.name);
        if (raw === undefined) continue;
        const value = coerceDetailField(f, raw, rowErrors, rowNumber);
        if (value !== undefined) lineDetails[f.name] = value;
      }
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      product_master_id: product.id,
      product_code_input: product.code,
      qty,
      estimated_price: estimatedPrice,
      technical_eval_method: evalMethod,
      technical_weight: technicalWeight,
      price_weight: priceWeight,
      split_award_allowed: parseBool(get("split_award_allowed")),
      min_rating_threshold_override: minRating,
      line_details: lineDetails,
    });
  }
  return { rows, errors };
}
