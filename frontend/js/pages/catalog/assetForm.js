import { renderProductForm } from "./productForm.js";

// Spec 4.2.1 — Asset (capital/medical equipment, IT hardware, furniture).
const ASSET_FIELDS = [
  { name: "asset_category", label: "Asset category", kind: "text" },
  { name: "expected_useful_life_years", label: "Expected useful life (years)", kind: "number" },
  { name: "warranty_months", label: "Warranty period (months)", kind: "number" },
  { name: "installation_required", label: "Installation / commissioning required", kind: "bool" },
  { name: "amc_cmc_applicable", label: "AMC / CMC applicable", kind: "bool" },
  { name: "compliance_certifications", label: "Required compliance certifications (CE, BIS, ISO, FDA…)", kind: "list" },
  { name: "site_readiness", label: "Site-readiness prerequisites (power, space, civil work)", kind: "textarea" },
];

export function openAssetForm(host, product, categories, onSaved, onCancel) {
  renderProductForm({ host, procurementType: "asset", typeLabel: "Asset", typeFields: ASSET_FIELDS, product, categories, onSaved, onCancel });
}
