// Spec §6.3.1-6.3.3 type-specific tender line-item fields, mirroring the
// catalog forms' itemForm.js/assetForm.js/serviceForm.js field-description
// pattern (see ../catalog/formKit.js) and app/schemas/line_details.py on the
// backend exactly. Rendered generically by tenderLineItems.js.

const ITEM_LINE_FIELDS = [
  { name: "hsn_sac_code", label: "HSN/SAC code", kind: "text" },
  { name: "alternate_brand_allowed", label: "Alternate/equivalent brand allowed", kind: "bool" },
  { name: "delivery_date", label: "Required delivery date", kind: "date" },
  { name: "delivery_location", label: "Required delivery location", kind: "text" },
  { name: "technical_spec_override", label: "Technical specification — line-specific notes (in addition to master spec)", kind: "textarea" },
];

const ASSET_LINE_FIELDS = [
  { name: "required_certifications", label: "Required certifications (CE, BIS, ISO, FDA…)", kind: "list" },
  { name: "brand_restriction", label: "Brand restriction", kind: "text" },
  { name: "warranty_requirement_months", label: "Warranty required (months)", kind: "number" },
  {
    name: "amc_cmc_arrangement", label: "Post-warranty AMC/CMC", kind: "select",
    options: [["this_line", "Quoted as part of this line"], ["linked_service_line", "Quoted as a linked Service line"], ["none", "Not required"]],
  },
  { name: "installation_notes", label: "Installation / commissioning & site-readiness notes", kind: "textarea" },
  { name: "training_required", label: "Training required", kind: "bool" },
  { name: "training_details", label: "Training details (sessions, duration)", kind: "text", showWhen: { training_required: "true" } },
  { name: "spares_commitment_months", label: "Spare-parts/serviceability commitment (months)", kind: "number" },
  { name: "exchange_buyback", label: "Old asset exchange / buy-back", kind: "bool" },
  { name: "exchange_asset_reference", label: "Reference asset ID being exchanged", kind: "text", showWhen: { exchange_buyback: "true" } },
  { name: "delivery_date", label: "Required delivery / installation date", kind: "date" },
  { name: "delivery_location", label: "Required delivery / installation location", kind: "text" },
];

const SERVICE_LINE_FIELDS = [
  { name: "scope_of_work", label: "Scope of Work (SOW)", kind: "textarea" },
  { name: "tenure_months", label: "Service tenure/duration (months)", kind: "number" },
  { name: "renewal_terms", label: "Renewal terms", kind: "text" },
  { name: "sla_response_time_hours", label: "SLA — response time (hours)", kind: "number" },
  { name: "sla_uptime_pct", label: "SLA — uptime (%)", kind: "number" },
  { name: "sla_resolution_time_hours", label: "SLA — resolution time (hours)", kind: "number" },
  { name: "sla_penalty_clauses", label: "SLA — penalty / liquidated-damages clauses", kind: "textarea" },
  {
    name: "billing_basis", label: "Billing basis", kind: "select",
    options: [["fixed", "Fixed periodic fee"], ["consumption", "Consumption-based"], ["milestone", "Milestone-based"]],
  },
  { name: "manpower_deployment_norms", label: "Manpower deployment norms (headcount, shifts, qualifications)", kind: "textarea" },
  { name: "background_verification_required", label: "Background verification / statutory compliance required", kind: "bool" },
  { name: "statutory_compliance_notes", label: "Statutory compliance notes (police verification, PF/ESI…)", kind: "textarea", showWhen: { background_verification_required: "true" } },
  { name: "insurance_requirement", label: "Insurance / indemnity requirement", kind: "text" },
  { name: "exit_transition_clause", label: "Exit / transition clause", kind: "textarea" },
  { name: "service_locations", label: "Service location(s)", kind: "list" },
  { name: "license_ip_terms_notes", label: "License / IP terms — line-specific notes (software lines)", kind: "textarea" },
];

export const LINE_DETAIL_FIELDS_BY_TYPE = {
  item: ITEM_LINE_FIELDS,
  asset: ASSET_LINE_FIELDS,
  service: SERVICE_LINE_FIELDS,
};
