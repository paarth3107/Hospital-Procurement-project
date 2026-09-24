import { renderProductForm } from "./productForm.js";

// Spec 4.2.1 — Service, plus 4.2.2's software sub-categories. Picking a
// "Software kind" reveals the matching extra fields.
const DEV = { software_kind: "development" };
const LIC = { software_kind: "licensing" };

const SERVICE_FIELDS = [
  { name: "sow_template", label: "Standard SOW template", kind: "textarea" },
  { name: "default_tenure_months", label: "Default service tenure (months)", kind: "number" },
  { name: "sla_response_time_hours", label: "SLA — response time (hours)", kind: "number" },
  { name: "sla_uptime_pct", label: "SLA — uptime (%)", kind: "number" },
  { name: "sla_penalty_clauses", label: "SLA — penalty clauses", kind: "textarea" },
  {
    name: "billing_basis",
    label: "Billing basis",
    kind: "select",
    options: [["fixed", "Fixed"], ["consumption", "Consumption"], ["milestone", "Milestone"]],
  },
  { name: "manpower_deployment_norms", label: "Manpower deployment norms (if applicable)", kind: "textarea" },

  {
    name: "software_kind",
    label: "Software service? (spec 4.2.2)",
    kind: "select",
    options: [["development", "Software Development / Custom Build"], ["licensing", "Software Licensing (COTS / SaaS)"]],
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
    options: [["perpetual", "Perpetual"], ["subscription", "Subscription"], ["saas", "SaaS"]],
    showWhen: LIC,
  },
  { name: "license_tenure_renewal", label: "License tenure and renewal terms", kind: "text", showWhen: LIC },
  { name: "seats_or_usage_tier", label: "Number of users / seats or usage tier", kind: "text", showWhen: LIC },
  {
    name: "deployment_model",
    label: "Deployment model",
    kind: "select",
    options: [["on_prem", "On-prem"], ["cloud", "Cloud"], ["hybrid", "Hybrid"]],
    showWhen: LIC,
  },
  { name: "data_residency_dpdp", label: "Data residency and DPDP Act compliance", kind: "text", showWhen: LIC },
  { name: "support_sla_tier", label: "Support / SLA tier", kind: "text", showWhen: LIC },
  { name: "upgrade_patch_policy", label: "Upgrade / patch policy", kind: "text", showWhen: LIC },
  { name: "exit_data_portability", label: "Exit / data-portability terms", kind: "text", showWhen: LIC },
];

export function openServiceForm(host, product, categories, onSaved, onCancel) {
  renderProductForm({ host, procurementType: "service", typeLabel: "Service", typeFields: SERVICE_FIELDS, product, categories, onSaved, onCancel });
}
