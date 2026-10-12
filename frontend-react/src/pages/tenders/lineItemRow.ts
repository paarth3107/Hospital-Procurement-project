import type { CatalogProduct, LineAttachment, LineItem, TechnicalEvalMethod } from "../../lib/types";

// The grid's own in-progress editing shape -- ported from
// frontend/js/pages/tenders/tenderLineItems.js's blankRow()/mapApiLineItems.
// Deliberately NOT the same shape as the API's LineItem: `product_code_input`
// is what's typed/pasted/imported (kept even if it doesn't resolve, so a
// typo stays visible to fix), and `id` is null until the tender's been
// saved at least once (attachments need a real id).
export interface LineItemRow {
  id: number | null;
  product_master_id: number | null;
  product_code_input: string;
  qty: number | null;
  estimated_price: number | null;
  technical_eval_method: TechnicalEvalMethod | null;
  technical_weight: number | null;
  price_weight: number | null;
  split_award_allowed: boolean;
  min_rating_threshold_override: number | null;
  line_details: Record<string, unknown>;
  attachments: LineAttachment[];
}

// What the backend needs for each row (rowsForPayload()'s output shape) --
// procurement type comes from the catalog entry, resolved at the point of
// building the payload.
export interface LineItemPayload {
  id: number | null;
  product_master_id: number | null;
  procurement_type: string | undefined;
  qty: number | null;
  estimated_price: number | null;
  technical_eval_method: TechnicalEvalMethod;
  technical_weight: number | null;
  price_weight: number | null;
  split_award_allowed: boolean;
  min_rating_threshold_override: number | null;
  line_details: Record<string, unknown>;
}

// Ported from tenderForm.js's mapApiLineItems -- shared between the initial
// load and the refresh after every save. A freshly-created line only gets a
// real id (and so becomes attachment-capable) once the backend has assigned
// one. Resolves product_code_input against the `products` array the caller
// passes in directly (not a prop/state read elsewhere), so this is safe to
// call the instant a fresh catalog fetch resolves, before any state update
// from it has flushed into any component's props.
export const mapApiLineItems = (items: LineItem[], products: CatalogProduct[]): LineItemRow[] =>
  items.map((li) => ({
    id: li.id,
    product_master_id: li.product_master_id,
    product_code_input: products.find((p) => p.id === li.product_master_id)?.code || "",
    qty: li.qty,
    estimated_price: li.estimated_price,
    technical_eval_method: li.technical_eval_method,
    technical_weight: li.technical_weight,
    price_weight: li.price_weight,
    split_award_allowed: li.split_award_allowed,
    min_rating_threshold_override: li.min_rating_threshold_override,
    line_details: li.line_details,
    attachments: li.attachments || [],
  }));

export const blankRow = (): LineItemRow => ({
  id: null,
  product_master_id: null,
  product_code_input: "",
  qty: null,
  estimated_price: null,
  technical_eval_method: null,
  technical_weight: null,
  price_weight: null,
  split_award_allowed: false,
  min_rating_threshold_override: null,
  line_details: {},
  attachments: [],
});
