import { forwardRef, Fragment, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, API_BASE, apiHeaders, uploadWithProgress } from "../../lib/api";
import { inr } from "../../lib/format";
import { fileTypeError } from "../../lib/fileValidation";
import { coerceFieldValue, initialFieldValues, type FieldDef } from "../../lib/formFields";
import { FormField } from "../../components/FormField";
import { Req } from "../../components/Req";
import { useModal } from "../../components/useModal";
import { canPreviewInApp } from "../../components/DocumentPreviewModal";
import type { CatalogProduct, LineItem, TechnicalEvalMethod, TenderLineAttachmentKind } from "../../lib/types";
import { blankRow, type LineItemPayload, type LineItemRow } from "./lineItemRow";
import { LINE_DETAIL_FIELDS_BY_TYPE } from "./lineDetailFields";
import { CORE_COLUMNS, EVAL_METHODS, buildTemplateCsv, downloadTextFile, importCsvRows, parseBool } from "./lineItemsCsv";
import { AttachmentsPanel } from "./AttachmentsPanel";

// Ported 1:1 from frontend/js/pages/tenders/tenderLineItems.js -- a real
// tender can carry hundreds of lines, so this is a flat spreadsheet-style
// table instead of one panel per line: type, tab, or paste a block copied
// straight out of Excel (paste columns match the CSV template's core
// columns exactly), or upload a CSV wholesale. Type-specific fields (12-14
// per type, see lineDetailFields.ts) don't fit a flat grid, so they live
// behind a per-row "Details" expansion instead of their own column each.
//
// React simplification over the vanilla version: there's no flushDetailsRow()
// equivalent here. Vanilla's Details expansion fields are read from the DOM
// only when something forces a flush (toggling Details closed, building the
// save payload); here every field is a controlled input bound straight to
// `rows[i].line_details`, committed immediately on every change, so there's
// nothing to defer or forget to flush.
//
// Exposes the same function-shaped API the vanilla module exported (getRows,
// rowsForPayload, firstRowProblem, totalBudget, setRows, applySavedLineItems,
// startWithBlankRows) through a ref, since TenderForm (Stage 3/4) needs to
// call these at arbitrary points the same way tenderForm.js did -- not just
// react to an onChange event.
export interface LineItemsGridHandle {
  getRows: () => LineItemRow[];
  rowsForPayload: () => LineItemPayload[];
  firstRowProblem: () => string | null;
  totalBudget: () => number;
  setRows: (rows: LineItemRow[]) => void;
  applySavedLineItems: (items: LineItem[]) => void;
  startWithBlankRows: () => void;
}

// A brand-new tender starts with a handful of empty rows ready to type into,
// not just one -- found 2026-10-14, user-directed. An untouched blank row
// (never got a code, qty or price typed into it) is silently dropped on
// save/submit (isRowSavable/isRowBlank below), so there's no cost to always
// having a few spares on screen.
const DEFAULT_BLANK_ROWS = 5;

// Spec §9.2.1: Item lines default to Qualify/Disqualify; Asset and Service
// lines default to Scored Technical Ranking. Either can be changed freely --
// this only picks a sensible starting point once a catalog entry resolves.
const DEFAULT_EVAL_METHOD: Record<string, TechnicalEvalMethod> = { item: "qualify_disqualify", asset: "scored", service: "scored" };
// Spec §9.4's own suggested starting points.
const DEFAULT_QCBS_WEIGHTS: Record<string, [number, number]> = { item: [70, 30], asset: [70, 30], service: [60, 40] };
const EVAL_METHOD_SHORT: Record<TechnicalEvalMethod, string> = { qualify_disqualify: "Qualify/Disqualify", scored: "Scored", qcbs: "QCBS" };

// Paste (and CSV) column order -- keep this in lockstep with lineItemsCsv.ts's
// CORE_COLUMNS; "product_code" there maps to this row's product_code_input.
const GRID_COLUMNS = CORE_COLUMNS.map((c) => (c === "product_code" ? "product_code_input" : c));
const NUMERIC_FIELDS = new Set(["qty", "estimated_price", "technical_weight", "price_weight", "min_rating_threshold_override"]);

const lineBudget = (row: LineItemRow): number => (row.qty && row.estimated_price ? row.qty * row.estimated_price : 0);

// The absolute minimum a row needs to exist as a real TenderLineItem at all:
// a resolved catalog entry, full stop -- qty, eval method/weights and
// everything else can be filled in later. A draft save should never demand
// more than this per row -- no "everything must be perfect" wall before a
// document can even be attached, that's what Submit's own gate
// (firstRowProblem()) is for.
const isRowSavable = (row: LineItemRow): boolean => !!row.product_master_id;

// A row nobody has touched yet -- no code typed, no qty, no price. Default
// blank rows (and any row left over after removing a filled one) are this;
// submit validation skips them entirely instead of reporting them as
// incomplete, same way they're already silently left out of the save
// payload (isRowSavable above) -- found 2026-10-14, user-directed.
const isRowBlank = (row: LineItemRow): boolean => !row.product_code_input.trim() && row.qty == null && row.estimated_price == null;

export const LineItemsGrid = forwardRef<
  LineItemsGridHandle,
  {
    products: CatalogProduct[];
    tenderId: number | null; // null until the tender itself has been saved -- attachments need a real tender + line id to upload to
    onChange: () => void; // called after any row mutation -- parent re-runs its gate check
    onRequestSave: () => Promise<void>; // the no-"save first"-wall pattern: silently saves the draft if an attachment needs a real line id yet
  }
>(function LineItemsGrid({ products, tenderId, onChange, onRequestSave }, ref) {
  const [rows, setRowsState] = useState<LineItemRow[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [importErrors, setImportErrors] = useState<string[]>([]);
  // "<row index>:<kind>" currently mid-upload, if any -- see AttachmentsPanel.tsx's own comment.
  const [busyAttachment, setBusyAttachment] = useState<string | null>(null);
  const [attachmentProgress, setAttachmentProgress] = useState(0);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const { promptAsync, openPreview, modalElement } = useModal();
  // Real bug, found 2026-10-14: the product code cell used a native
  // <input list="..."> + <datalist>, i.e. the browser's own stock
  // autocomplete UI -- not styled like anything else in the app. Replaced
  // with the same kind of dropdown panel QuickSearch.tsx uses
  // (shell/QuickSearch.tsx's .ep-search-results pattern), just scoped to
  // one row's cell instead of the topbar.
  //
  // Real bug, found 2026-10-14 (second pass): that first version anchored
  // the panel with position:absolute inside the table cell -- it visually
  // sank underneath the next row instead of floating over it (a table's own
  // cell/row background painting order doesn't reliably respect z-index the
  // way normal block boxes do). Rendered through a portal instead, exactly
  // like every dialog in components/ already does (createPortal to
  // document.body), positioned from the input's own getBoundingClientRect()
  // so it's immune to the table/scroll-container it's triggered from.
  const [codeDropdownRow, setCodeDropdownRow] = useState<number | null>(null);
  const [codeHighlight, setCodeHighlight] = useState(0);
  const [codeDropdownRect, setCodeDropdownRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const productOf = (row: LineItemRow): CatalogProduct | undefined => products.find((p) => p.id === row.product_master_id);

  // A product already on another row just doesn't show up as a pickable
  // option any more (user-directed, 2026-10-16 -- a validation error after
  // the fact wasn't what they wanted, the duplicate shouldn't be offered in
  // the first place). Excludes only OTHER rows' picks, not this row's own
  // current selection -- re-opening the dropdown on a row that already has
  // a product shouldn't make that product vanish from its own list.
  function matchingProducts(query: string, excludeRowIndex: number): CatalogProduct[] {
    const usedElsewhere = new Set(rows.filter((r, idx) => idx !== excludeRowIndex && r.product_master_id != null).map((r) => r.product_master_id));
    const available = products.filter((p) => !usedElsewhere.has(p.id));
    const q = query.trim().toLowerCase();
    const list = q ? available.filter((p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) : available;
    return list.slice(0, 50);
  }

  function openCodeDropdown(i: number, input: HTMLInputElement) {
    const rect = input.getBoundingClientRect();
    setCodeDropdownRow(i);
    setCodeHighlight(0);
    setCodeDropdownRect({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 260) });
  }

  function pickProduct(i: number, p: CatalogProduct) {
    updateRow(i, (r) => resolveProduct({ ...r, product_code_input: p.code }));
    setCodeDropdownRow(null);
  }

  // Re-resolves product_master_id from whatever's typed in the code cell.
  // Only called on commit (blur/change/paste/import), never on every
  // keystroke, so line_details isn't wiped out mid-typing.
  function resolveProduct(row: LineItemRow): LineItemRow {
    const code = row.product_code_input.trim().toLowerCase();
    const p = code ? products.find((x) => x.code.trim().toLowerCase() === code) : null;
    const changedProduct = (p?.id ?? null) !== row.product_master_id;
    const next: LineItemRow = { ...row, product_master_id: p ? p.id : null };
    if (changedProduct) next.line_details = {};
    if (p && !next.technical_eval_method) next.technical_eval_method = DEFAULT_EVAL_METHOD[p.procurement_type];
    // Service tenure has a catalog default, not an authoritative value -- pre-fill
    // it so the common case (this engagement matches the standard term) needs no
    // typing, while still leaving it editable for the engagements that don't.
    if (changedProduct && p?.procurement_type === "service" && next.line_details?.tenure_months == null) {
      const defaultTenure = (p.type_specific_attrs as Record<string, unknown> | undefined)?.default_tenure_months;
      if (defaultTenure != null) next.line_details = { ...next.line_details, tenure_months: defaultTenure };
    }
    return next;
  }

  const setRows = (next: LineItemRow[]) => {
    setRowsState(next);
    onChange();
  };
  const updateRow = (i: number, fn: (row: LineItemRow) => LineItemRow) => {
    setRows(rows.map((r, idx) => (idx === i ? fn(r) : r)));
  };

  useImperativeHandle(ref, () => ({
    getRows: () => rows,
    rowsForPayload: () =>
      rows.filter(isRowSavable).map((li) => ({
        id: li.id, // lets the backend match this against its existing row instead of recreating it, which would lose its attachments
        product_master_id: li.product_master_id,
        procurement_type: productOf(li)?.procurement_type,
        qty: li.qty,
        estimated_price: li.estimated_price,
        technical_eval_method: li.technical_eval_method || "qualify_disqualify",
        technical_weight: li.technical_weight,
        price_weight: li.price_weight,
        split_award_allowed: !!li.split_award_allowed,
        min_rating_threshold_override: li.min_rating_threshold_override,
        line_details: li.line_details || {},
      })),
    firstRowProblem: () => {
      // Real bug, found 2026-10-16: the same catalog entry could be added on
      // more than one row with nothing to stop it -- two separate rows for
      // the same product would resolve into two separate eligibility
      // previews/invites/bid forms for vendors, which makes no sense (which
      // one is "the" line for that item?). Tracked by row number as rows are
      // walked in order, so the error always points at the LATER row --
      // the first one written is treated as "the" entry, the duplicate is
      // what needs fixing.
      const firstRowForProduct = new Map<number, number>();
      for (let i = 0; i < rows.length; i++) {
        const li = rows[i];
        if (isRowBlank(li)) continue; // untouched -- silently dropped, not an error (isRowSavable above)
        const n = i + 1;
        if (!li.product_master_id) return `Row ${n}: needs a valid catalog entry — check the product code.`;
        const earlierRow = firstRowForProduct.get(li.product_master_id);
        if (earlierRow !== undefined) {
          const code = productOf(li)?.code;
          return `Row ${n}: ${code ? `Product ${code}` : "This catalog entry"} is already on Row ${earlierRow} — each item can only appear once per tender.`;
        }
        firstRowForProduct.set(li.product_master_id, n);
        if (!(li.qty! > 0)) return `Row ${n}: needs a quantity greater than zero.`;
        if (li.technical_eval_method === "qcbs" && (!(li.technical_weight! > 0) || !(li.price_weight! > 0))) {
          return `Row ${n}: QCBS needs both a technical weight and a price weight, greater than zero.`;
        }
      }
      return null;
    },
    totalBudget: () => rows.reduce((n, r) => n + lineBudget(r), 0),
    // Takes fully-formed rows (product_code_input already resolved) rather
    // than resolving codes here from this component's own `products` prop
    // -- a real ordering hazard otherwise: the caller (TenderEditorPage)
    // calls this right after fetching a fresh catalog via setState, which
    // hasn't flushed into this component's props yet at that exact moment
    // (React state updates aren't synchronous), so a same-tick lookup here
    // would silently resolve against the OLD (often empty) products prop.
    // mapApiLineItems() in lineItemRow.ts does the resolution against
    // whatever catalog array the caller actually just fetched.
    setRows: (newRows) => {
      setExpandedRows(new Set());
      setRowsState(newRows.map((r) => ({ ...blankRow(), ...r })));
    },
    // Applies a save's result back onto the existing rows array IN PLACE --
    // never a wholesale replacement, which would wipe out any row that
    // wasn't savable yet (excluded from the payload, so absent from `items`)
    // along with whatever the officer was still typing into it. Matches a
    // pre-existing row by its own id; a newly-created row (id was null when
    // sent) is matched by position among just the freshly-inserted items,
    // ordered by id -- correct because within one save, new rows are
    // inserted in payload order, so their auto-assigned ids come out in
    // that same order even when interleaved with pre-existing ids that
    // don't follow it.
    applySavedLineItems: (items) => {
      const oldIds = new Set(rows.map((r) => r.id).filter((id): id is number => id != null));
      const byOldId = new Map(items.filter((it) => oldIds.has(it.id)).map((it) => [it.id, it]));
      const freshQueue = items.filter((it) => !oldIds.has(it.id)).sort((a, b) => a.id - b.id);
      let freshIdx = 0;
      setRowsState((current) =>
        current.map((row) => {
          if (!isRowSavable(row)) return row; // wasn't sent -- left exactly as the officer has it
          const server = row.id != null ? byOldId.get(row.id) : freshQueue[freshIdx++];
          if (!server) return row; // defensive only -- shouldn't happen after a successful save
          return {
            ...row,
            id: server.id,
            qty: server.qty,
            estimated_price: server.estimated_price,
            technical_eval_method: server.technical_eval_method,
            technical_weight: server.technical_weight,
            price_weight: server.price_weight,
            split_award_allowed: server.split_award_allowed,
            min_rating_threshold_override: server.min_rating_threshold_override,
            line_details: server.line_details,
            attachments: server.attachments || [],
          };
        })
      );
    },
    startWithBlankRows: () => {
      setExpandedRows(new Set());
      setRowsState(Array.from({ length: DEFAULT_BLANK_ROWS }, blankRow));
    },
  }));

  // ---- Typing / commit handlers ----

  const onCodeInput = (i: number, value: string, input: HTMLInputElement) => {
    updateRow(i, (r) => ({ ...r, product_code_input: value }));
    openCodeDropdown(i, input);
  };
  const onCodeCommit = (i: number) => updateRow(i, resolveProduct);
  const onCodeKeyDown = (i: number, row: LineItemRow, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (codeDropdownRow !== i) return;
    const matches = matchingProducts(row.product_code_input, i);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCodeHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCodeHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (matches[codeHighlight]) {
        e.preventDefault();
        pickProduct(i, matches[codeHighlight]);
      }
    } else if (e.key === "Escape") {
      setCodeDropdownRow(null);
    }
  };

  const onNumericInput = (i: number, field: "qty" | "estimated_price" | "technical_weight" | "price_weight" | "min_rating_threshold_override", value: string) =>
    updateRow(i, (r) => ({ ...r, [field]: value === "" ? null : Number(value) }));

  const onEvalMethodChange = (i: number, value: string) =>
    updateRow(i, (r) => {
      const method = (value || null) as TechnicalEvalMethod | null;
      const next: LineItemRow = { ...r, technical_eval_method: method };
      if (method === "qcbs" && !r.technical_weight && !r.price_weight) {
        const p = productOf(r);
        const [tw, pw] = DEFAULT_QCBS_WEIGHTS[p?.procurement_type || "item"];
        next.technical_weight = tw;
        next.price_weight = pw;
      }
      return next;
    });

  const onSplitAwardChange = (i: number, checked: boolean) => updateRow(i, (r) => ({ ...r, split_award_allowed: checked }));

  const updateLineDetail = (i: number, field: FieldDef, value: string) =>
    updateRow(i, (r) => {
      const coerced = coerceFieldValue(field, value);
      const nextDetails = { ...r.line_details };
      if (coerced === undefined) delete nextDetails[field.name];
      else nextDetails[field.name] = coerced;
      return { ...r, line_details: nextDetails };
    });

  const toggleDetails = (i: number) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const removeRow = (i: number) => {
    setExpandedRows((prev) => {
      const shifted = new Set<number>();
      for (const idx of prev) if (idx !== i) shifted.add(idx > i ? idx - 1 : idx);
      return shifted;
    });
    setRows(rows.filter((_, idx) => idx !== i));
  };

  // ---- Attachments (no "save first" wall: attaching silently saves the
  // tender via onRequestSave if it hasn't been saved yet) ----

  async function ensureLineSaved(i: number): Promise<number> {
    if (rows[i].id != null) return rows[i].id!;
    await onRequestSave();
    // Re-read rows[i] fresh rather than reusing a closed-over reference --
    // onRequestSave's save round-trip replaces row objects (applySavedLineItems).
    return new Promise((resolve, reject) => {
      setRowsState((current) => {
        if (current[i]?.id == null) reject(new Error("Could not save this line -- fix any errors above and try again."));
        else resolve(current[i].id!);
        return current;
      });
    });
  }

  const uploadAttachment = async (i: number, kind: TenderLineAttachmentKind) => {
    if (busyAttachment === `${i}:${kind}`) return;
    let customLabel: string | null = null;
    if (kind === "other") {
      customLabel = await promptAsync("What is this document?", "e.g. Site photograph");
      if (customLabel === null) return; // cancelled
    }
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
        const lineId = await ensureLineSaved(i);
        const fd = new FormData();
        fd.append("kind", kind);
        if (customLabel) fd.append("custom_label", customLabel);
        fd.append("file", file);
        const att = await uploadWithProgress(`/tenders/${tenderId}/line-items/${lineId}/attachments`, fd, setAttachmentProgress);
        updateRow(i, (r) => ({ ...r, attachments: [...r.attachments, att as LineItemRow["attachments"][number]] }));
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
      await api(`/tenders/${tenderId}/line-items/${rows[i].id}/attachments/${attachmentId}`, { method: "DELETE" });
      updateRow(i, (r) => ({ ...r, attachments: r.attachments.filter((a) => a.id !== attachmentId) }));
    } catch (err) {
      window.alert("Could not remove: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const viewAttachment = async (lineId: number, attachmentId: number, filename: string) => {
    try {
      const res = await fetch(`${API_BASE}/tenders/${tenderId}/line-items/${lineId}/attachments/${attachmentId}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (canPreviewInApp(blob.type)) openPreview({ url, filename, contentType: blob.type }, () => URL.revokeObjectURL(url));
      else window.open(url, "_blank");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  // ---- Paste from Excel: only intercept a genuine multi-cell paste
  // (contains a tab or a newline) -- a normal single-value paste is left to
  // the browser. Pasted columns line up with GRID_COLUMNS, the same order
  // the CSV template and Download-template button use, so a block copied
  // straight out of a spreadsheet the officer already had drops in as-is. ----
  const onGridPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("input[data-row][data-col], select[data-row][data-col]");
    if (!target) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    e.preventDefault();
    const startRow = Number(target.dataset.row);
    const startCol = Number(target.dataset.col);
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();

    const next = rows.slice();
    lines.forEach((line, li) => {
      const rowIdx = startRow + li;
      while (rowIdx >= next.length) next.push(blankRow());
      let row = next[rowIdx];
      line.split("\t").forEach((val, ci) => {
        const colIdx = startCol + ci;
        if (colIdx >= GRID_COLUMNS.length) return;
        const field = GRID_COLUMNS[colIdx];
        const v = val.trim();
        if (field === "product_code_input") {
          row = resolveProduct({ ...row, product_code_input: v });
        } else if (NUMERIC_FIELDS.has(field)) {
          row = { ...row, [field]: v === "" ? null : Number(v) };
        } else if (field === "technical_eval_method") {
          const match = EVAL_METHODS.find((m) => m.toLowerCase() === v.toLowerCase());
          if (match) row = { ...row, technical_eval_method: match };
        } else if (field === "split_award_allowed") {
          row = { ...row, split_award_allowed: parseBool(v) };
        }
      });
      next[rowIdx] = row;
    });
    setRows(next);
  };

  // ---- Add row(s) / CSV template+import ----

  const addRow = () => setRows([...rows, blankRow()]);
  const add10Rows = () => setRows([...rows, ...Array.from({ length: 10 }, blankRow)]);
  const downloadTemplate = () => downloadTextFile("tender-line-items-template.csv", buildTemplateCsv());

  const onCsvFileChosen = async (file: File) => {
    const text = await file.text();
    const { rows: imported, errors } = importCsvRows(text, products);
    if (imported.length) {
      setRows([
        ...rows,
        ...imported.map((row) => {
          if (!row.technical_eval_method) {
            const p = products.find((x) => x.id === row.product_master_id);
            if (p) row.technical_eval_method = DEFAULT_EVAL_METHOD[p.procurement_type];
          }
          return row;
        }),
      ]);
    }
    setImportErrors(errors);
  };

  // ---- Render ----

  const totalBudgetNow = rows.reduce((n, r) => n + lineBudget(r), 0);
  const LINE_COLS = 9; // #, Product Code, Product Name, Qty, Est. Price/Unit, Eval Method, Split Award, Line Total, Actions

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Line Items</span>
        <span className="ep-k">
          {rows.filter((r) => !isRowBlank(r)).length} line item(s) · total estimated value {inr(totalBudgetNow)}
        </span>
      </div>
      <div className="ep-pane-pad">
        <div className="hint mb-14px">each line is evaluated and awarded independently · click Details for type-specific fields, evaluation weights, and attachments</div>
        <div className="li-grid-wrap" onPaste={onGridPaste} onScroll={() => setCodeDropdownRow(null)}>
          <table className="ep-table li-grid">
            <thead>
              <tr>
                <th className="ep-th">#</th>
                <th className="ep-th">
                  Product Code
                  <Req />
                </th>
                <th className="ep-th">Product Name</th>
                <th className="ep-th">
                  Qty
                  <Req />
                </th>
                <th className="ep-th">Est. Price/Unit</th>
                <th className="ep-th">Eval Method</th>
                <th className="ep-th">Split Award</th>
                <th className="ep-th">Line Total</th>
                <th className="ep-th"></th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td className="ep-cell hint" colSpan={LINE_COLS}>
                    No line items yet — add a row or upload a CSV.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const p = productOf(row);
                  const codeTyped = row.product_code_input.trim() !== "";
                  const codeInvalid = codeTyped && !p;
                  const total = lineBudget(row);
                  const qcbs = row.technical_eval_method === "qcbs";
                  const expanded = expandedRows.has(i);
                  const detailFields = p ? LINE_DETAIL_FIELDS_BY_TYPE[p.procurement_type] || [] : [];
                  const detailsRaw = p ? initialFieldValues(detailFields, row.line_details) : {};
                  return (
                    <Fragment key={i}>
                      <tr className="li-row">
                        <td className="ep-cell li-rownum">{i + 1}</td>
                        <td className="ep-cell li-code-cell">
                          <input
                            className={`input${codeInvalid ? " invalid" : ""}`}
                            autoComplete="off"
                            data-row={i}
                            data-col={0}
                            value={row.product_code_input}
                            onChange={(e) => onCodeInput(i, e.target.value, e.target)}
                            onFocus={(e) => openCodeDropdown(i, e.target)}
                            onKeyDown={(e) => onCodeKeyDown(i, row, e)}
                            onBlur={() => {
                              onCodeCommit(i);
                              setCodeDropdownRow((r) => (r === i ? null : r));
                            }}
                            placeholder="code"
                          />
                        </td>
                        <td className="ep-cell li-product-name">
                          {p ? (
                            p.name
                          ) : codeInvalid ? (
                            <span className="text-danger-700">unknown code</span>
                          ) : (
                            ""
                          )}
                        </td>
                        <td className="ep-cell">
                          <input
                            className="input"
                            type="number"
                            step="any"
                            min={0}
                            data-row={i}
                            data-col={1}
                            value={row.qty ?? ""}
                            onChange={(e) => onNumericInput(i, "qty", e.target.value)}
                          />
                        </td>
                        <td className="ep-cell">
                          <input
                            className="input"
                            type="number"
                            step="any"
                            min={0}
                            data-row={i}
                            data-col={2}
                            value={row.estimated_price ?? ""}
                            onChange={(e) => onNumericInput(i, "estimated_price", e.target.value)}
                          />
                        </td>
                        <td className="ep-cell">
                          <select
                            className="input"
                            data-row={i}
                            data-col={3}
                            value={row.technical_eval_method ?? ""}
                            onChange={(e) => onEvalMethodChange(i, e.target.value)}
                          >
                            <option value="">{p ? "default" : "—"}</option>
                            {EVAL_METHODS.map((m) => (
                              <option value={m} key={m}>
                                {EVAL_METHOD_SHORT[m]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="ep-cell text-center">
                          <input type="checkbox" data-row={i} data-col={6} checked={row.split_award_allowed} onChange={(e) => onSplitAwardChange(i, e.target.checked)} />
                        </td>
                        <td className="ep-cell li-total">{total ? inr(total) : "—"}</td>
                        <td className="ep-cell nowrap">
                          <button type="button" className="ep-b li-details-btn" disabled={!p} onClick={() => toggleDetails(i)}>
                            {expanded ? "Hide" : "Details"}
                          </button>{" "}
                          <button type="button" className="ep-b remove-line-btn" onClick={() => removeRow(i)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                      {expanded && p && (
                        <tr className="li-details-row">
                          <td className="ep-cell" colSpan={LINE_COLS}>
                            <div className="li-details">
                              <div className="li-details-section">
                                <div className="li-details-section-title">Evaluation &amp; Scoring</div>
                                <div className="line-details-fields d-grid grid-cols-repeat31fr gap-10px-16px">
                                  {qcbs && (
                                    <div className="ep-field">
                                      <div className="ep-k">
                                        Technical Weight
                                        <Req />
                                      </div>
                                      <input
                                        className="input"
                                        type="number"
                                        step={1}
                                        min={0}
                                        value={row.technical_weight ?? ""}
                                        onChange={(e) => onNumericInput(i, "technical_weight", e.target.value)}
                                      />
                                    </div>
                                  )}
                                  {qcbs && (
                                    <div className="ep-field">
                                      <div className="ep-k">
                                        Price Weight
                                        <Req />
                                      </div>
                                      <input
                                        className="input"
                                        type="number"
                                        step={1}
                                        min={0}
                                        value={row.price_weight ?? ""}
                                        onChange={(e) => onNumericInput(i, "price_weight", e.target.value)}
                                      />
                                    </div>
                                  )}
                                  <div className="ep-field">
                                    <div className="ep-k">Min Rating Threshold Override</div>
                                    <input
                                      className="input"
                                      type="number"
                                      step={0.1}
                                      min={0}
                                      max={100}
                                      value={row.min_rating_threshold_override ?? ""}
                                      onChange={(e) => onNumericInput(i, "min_rating_threshold_override", e.target.value)}
                                      placeholder="tender default"
                                    />
                                  </div>
                                </div>
                              </div>

                              {detailFields.length > 0 && (
                                <div className="li-details-section">
                                  <div className="li-details-section-title">Tender-Specific Details</div>
                                  <div className="line-details-fields d-grid grid-cols-repeat31fr gap-10px-16px">
                                    {detailFields.map((f) => (
                                      <FormField key={f.name} field={f} raw={detailsRaw} onChange={(_name, value) => updateLineDetail(i, f, value)} />
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="li-details-section">
                                <div className="li-details-section-title">Attachments</div>
                                <AttachmentsPanel
                                  attachments={row.attachments}
                                  procurementType={p.procurement_type}
                                  busyKind={busyAttachment?.startsWith(`${i}:`) ? (busyAttachment.slice(`${i}:`.length) as TenderLineAttachmentKind) : null}
                                  busyProgress={attachmentProgress}
                                  onUpload={(kind) => uploadAttachment(i, kind)}
                                  onRemove={(attId) => removeAttachment(i, attId)}
                                  onView={(attId, filename) => row.id != null && viewAttachment(row.id, attId, filename)}
                                />
                              </div>
                            </div>
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
        <div className="d-flex gap-8px flex-wrap mt-14px">
          <button type="button" className="ep-b" onClick={addRow}>
            + Add Line Item
          </button>
          <button type="button" className="ep-b" onClick={add10Rows}>
            + Add 10 Line Items
          </button>
          <button type="button" className="ep-b" onClick={downloadTemplate}>
            Download CSV Template
          </button>
          <button type="button" className="ep-b" onClick={() => csvFileInputRef.current?.click()}>
            Upload CSV
          </button>
          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // lets the same filename be re-uploaded later (e.g. after fixing rows)
              if (file) await onCsvFileChosen(file);
            }}
          />
        </div>
        {importErrors.length > 0 && (
          <div className="result err mt-10px">
            <div className="fw-700 mb-6px">{importErrors.length} row(s) need fixing before they can be added:</div>
            <ul className="margin-0 pl-18px">
              {importErrors.map((e, idx) => (
                <li key={idx}>{e}</li>
              ))}
            </ul>
            <div className="hint mt-6px">Fix these rows in your file and upload just them again — rows already added don't need to be re-uploaded.</div>
          </div>
        )}
      </div>
      {codeDropdownRow != null &&
        codeDropdownRect &&
        createPortal(
          (() => {
            const matches = matchingProducts(rows[codeDropdownRow].product_code_input, codeDropdownRow);
            return (
              <div className="li-code-results" style={{ position: "fixed", left: codeDropdownRect.left, top: codeDropdownRect.top, width: codeDropdownRect.width }}>
                {matches.length ? (
                  matches.map((prod, mi) => (
                    <button
                      type="button"
                      className={`li-code-item${mi === codeHighlight ? " highlighted" : ""}`}
                      key={prod.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickProduct(codeDropdownRow, prod)}
                    >
                      <span className="fw-600">{prod.code}</span>
                      <span className="ep-sub">{prod.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="ep-dropdown-empty">No matching catalog item.</div>
                )}
              </div>
            );
          })(),
          document.body
        )}
      {modalElement}
    </div>
  );
});
