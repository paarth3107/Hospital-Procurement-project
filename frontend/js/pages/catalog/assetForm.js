import { renderProductForm } from "./productForm.js";

// Spec 4.2.1 — Asset (capital/medical equipment, IT hardware, furniture).
const ASSET_FIELDS = [
  { name: "asset_category", label: "Asset category", kind: "text" },
  { name: "expected_useful_life_years", label: "Expected useful life (years)", kind: "number" },
  { name: "warranty_months", label: "Warranty period (months)", kind: "number" },
  { name: "installation_required", label: "Installation / commissioning required", kind: "bool" },
  { name: "compliance_certifications", label: "Required compliance certifications (CE, BIS, ISO, FDA…)", kind: "list" },
  { name: "site_readiness", label: "Site-readiness prerequisites (power, space, civil work)", kind: "textarea" },
  { name: "training_required", label: "Training required to operate", kind: "bool" },
  { name: "training_details", label: "Training details (sessions, duration)", kind: "text", showWhen: { training_required: "true" } },
  { name: "spares_commitment_months", label: "Spare-parts / serviceability commitment (months)", kind: "number" },
  { name: "insurance_requirement", label: "Insurance requirement (transit/installation), if any", kind: "text" },
  {
    name: "amc_cmc_type", label: "Post-warranty maintenance needed", kind: "select",
    options: [["none", "None"], ["amc", "AMC (labor covered, parts billed separately)"], ["cmc", "CMC (labor + parts both covered)"]],
  },
  {
    name: "amc_cmc_procurement", label: "How is it procured (if AMC/CMC applies)", kind: "select",
    options: [["bundled_with_purchase", "Bundled with this purchase"], ["separate_service_tender", "Separate service tender"]],
  },
];

export function openAssetForm(host, product, categories, subCategories, onSaved, onCancel) {
  renderProductForm({ host, procurementType: "asset", typeLabel: "Asset", typeFields: ASSET_FIELDS, product, categories, subCategories, onSaved, onCancel });
}
