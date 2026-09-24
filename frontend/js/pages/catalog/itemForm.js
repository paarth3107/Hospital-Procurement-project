import { renderProductForm } from "./productForm.js";

// Spec 4.2.1 — Item (consumables, pharmacy, general stores, surgical supplies).
// Unit of measure and reorder level are core details (see coreDetails.js).
const ITEM_FIELDS = [
  { name: "pack_size", label: "Pack size", kind: "text" },
  { name: "shelf_life_tracking", label: "Shelf-life / expiry tracking", kind: "bool" },
  { name: "storage_condition", label: "Storage condition (e.g. cold chain 2–8 °C)", kind: "text" },
];

export function openItemForm(host, product, categories, onSaved, onCancel) {
  renderProductForm({ host, procurementType: "item", typeLabel: "Item", typeFields: ITEM_FIELDS, product, categories, onSaved, onCancel });
}
