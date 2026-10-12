import type { FieldDef } from "../../lib/formFields";

// Ported 1:1 from frontend/js/pages/catalog/itemForm.js/assetForm.js/
// serviceForm.js -- pure data, so no behavior to re-verify here beyond the
// field list matching exactly. Spec 4.2.1 (Item/Asset/Service) + 4.2.2
// (software sub-categories).

// Spec 4.2.1 — Item (consumables, pharmacy, general stores, surgical supplies).
// Unit of measure and reorder level are Core Details, not here.
export const ITEM_FIELDS: FieldDef[] = [
  { name: "pack_size", label: "Pack size", kind: "text" },
  { name: "shelf_life_tracking", label: "Shelf-life / expiry tracking", kind: "bool" },
  { name: "storage_condition", label: "Storage condition (e.g. cold chain 2–8 °C)", kind: "text" },
  { name: "hsn_sac_code", label: "HSN/SAC code", kind: "text" },
  { name: "alternate_brand_allowed", label: "Alternate/equivalent brand allowed", kind: "bool" },
];

// Spec 4.2.1 — Asset (capital/medical equipment, IT hardware, furniture).
export const ASSET_FIELDS: FieldDef[] = [
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
    name: "amc_cmc_type",
    label: "Post-warranty maintenance needed",
    kind: "select",
    options: [
      ["none", "None"],
      ["amc", "AMC (labor covered, parts billed separately)"],
      ["cmc", "CMC (labor + parts both covered)"],
    ],
  },
  {
    name: "amc_cmc_procurement",
    label: "How is it procured (if AMC/CMC applies)",
    kind: "select",
    options: [
      ["bundled_with_purchase", "Bundled with this purchase"],
      ["separate_service_tender", "Separate service tender"],
    ],
  },
];

// Spec 4.2.1 — Service, plus 4.2.2's software sub-categories. Picking a
// "Software kind" reveals the matching extra fields.
const DEV = { software_kind: "development" };
const LIC = { software_kind: "licensing" };

export const SERVICE_FIELDS: FieldDef[] = [
  { name: "sow_template", label: "Standard SOW template", kind: "textarea" },
  { name: "default_tenure_months", label: "Default service tenure (months)", kind: "number" },
  { name: "renewal_terms", label: "Renewal terms", kind: "text" },
  { name: "sla_response_time_hours", label: "SLA — response time (hours)", kind: "number" },
  { name: "sla_uptime_pct", label: "SLA — uptime (%)", kind: "number" },
  { name: "sla_resolution_time_hours", label: "SLA — resolution time (hours)", kind: "number" },
  { name: "sla_penalty_clauses", label: "SLA — penalty clauses", kind: "textarea" },
  {
    name: "billing_basis",
    label: "Billing basis",
    kind: "select",
    options: [
      ["fixed", "Fixed"],
      ["consumption", "Consumption"],
      ["milestone", "Milestone"],
    ],
  },
  { name: "manpower_deployment_norms", label: "Manpower deployment norms (if applicable)", kind: "textarea" },
  { name: "insurance_requirement", label: "Insurance requirement (vendor liability/indemnity), if any", kind: "text" },
  { name: "exit_transition_clause", label: "Exit / transition clause", kind: "textarea" },
  { name: "background_verification_required", label: "Background verification / statutory compliance required", kind: "bool" },
  {
    name: "statutory_compliance_notes",
    label: "Statutory compliance notes (police verification, PF/ESI…)",
    kind: "textarea",
    showWhen: { background_verification_required: "true" },
  },

  {
    name: "software_kind",
    label: "Software service? (spec 4.2.2)",
    kind: "select",
    options: [
      ["development", "Software Development / Custom Build"],
      ["licensing", "Software Licensing (COTS / SaaS)"],
    ],
  },
  { name: "deliverables_sow", label: "Deliverable-based SOW (milestones / sprints)", kind: "textarea", showWhen: DEV },
  { name: "source_code_ownership_escrow", label: "Source code ownership and escrow terms", kind: "textarea", showWhen: DEV },
  { name: "ip_assignment", label: "IP assignment", kind: "text", showWhen: DEV },
  { name: "acceptance_testing_criteria", label: "Acceptance testing criteria", kind: "textarea", showWhen: DEV },
  { name: "warranty_defect_fix_period", label: "Warranty / defect-fix period after go-live", kind: "text", showWhen: DEV },
  { name: "post_go_live_support", label: "Post-go-live support / AMC terms", kind: "text", showWhen: DEV },
  { name: "technology_stack_constraints", label: "Technology stack constraints", kind: "text", showWhen: DEV },

  {
    name: "license_type",
    label: "License type",
    kind: "select",
    options: [
      ["perpetual", "Perpetual"],
      ["subscription", "Subscription"],
      ["saas", "SaaS"],
    ],
    showWhen: LIC,
  },
  { name: "license_tenure_renewal", label: "License tenure and renewal terms", kind: "text", showWhen: LIC },
  { name: "seats_or_usage_tier", label: "Number of users / seats or usage tier", kind: "text", showWhen: LIC },
  {
    name: "deployment_model",
    label: "Deployment model",
    kind: "select",
    options: [
      ["on_prem", "On-prem"],
      ["cloud", "Cloud"],
      ["hybrid", "Hybrid"],
    ],
    showWhen: LIC,
  },
  { name: "data_residency_dpdp", label: "Data residency and DPDP Act compliance", kind: "text", showWhen: LIC },
  { name: "support_sla_tier", label: "Support / SLA tier", kind: "text", showWhen: LIC },
  { name: "upgrade_patch_policy", label: "Upgrade / patch policy", kind: "text", showWhen: LIC },
  { name: "exit_data_portability", label: "Exit / data-portability terms", kind: "text", showWhen: LIC },
];

// Spec 4.2 core details. Every one is optional and chosen per catalog entry:
// the creator ticks the details that apply to THIS entry (a syringe may not
// need a regulatory class or brand list, an implant does). Unticked rows are
// saved as empty. `docs: true` marks the one row that's the required-
// documents picker instead of a plain field.
export interface CoreRow {
  label: string;
  fields: FieldDef[];
  docs?: boolean;
}

export const CORE_ROWS: CoreRow[] = [
  { label: "Unit of measure", fields: [{ name: "unit_of_measure", label: "", kind: "text" }] },
  { label: "Regulatory class (drug schedule / implant class)", fields: [{ name: "regulatory_class", label: "", kind: "text" }] },
  { label: "Preferred / approved brands", fields: [{ name: "approved_brands", label: "", kind: "list" }] },
  { label: "Standard reorder level", fields: [{ name: "reorder_level", label: "", kind: "number" }] },
  {
    label: "Unit price band (reference for bid anomaly checks)",
    fields: [
      { name: "price_band_min", label: "Min", kind: "number" },
      { name: "price_band_max", label: "Max", kind: "number" },
    ],
  },
  {
    label: "Restricted / critical — minimum vendor rating required for mapping",
    fields: [{ name: "min_mapping_rating", label: "Min rating (0–100)", kind: "number" }],
  },
  {
    label: "Documents required from a vendor to be mapped to this entry",
    docs: true,
    fields: [],
  },
];
