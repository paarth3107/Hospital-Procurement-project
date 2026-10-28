// On-the-spot field validation for Add/Edit Product, matching
// registerValidation.ts's pattern (ProductForm.tsx wires it the same way --
// FIELD_VALIDATORS, Req, FieldError, blur + submit sweep, noValidate). Only
// "required, non-empty" rules here -- backend/app/schemas/product.py's
// ProductCreate doesn't length-bound code/name the way vendor registration's
// fields are bounded, so this doesn't invent a limit the backend wouldn't
// also enforce.
const required =
  (label: string) =>
  (v: string): string | null =>
    v.trim() ? null : `${label} is required.`;

export const PRODUCT_FIELD_VALIDATORS: Record<string, (value: string) => string | null> = {
  code: required("Code / SKU"),
  name: required("Name"),
  category_id: required("Category"),
};
