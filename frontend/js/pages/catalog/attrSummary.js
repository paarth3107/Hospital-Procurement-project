import { inr } from "../../kit.js";
import { docLabel } from "../../constants.js";

// One-line, human summary of a catalog entry's type-specific attributes and
// core details, for the master table's "Type-specific attributes" column.
const LABELS = {
  pack_size: (v) => `pack of ${v}`,
  shelf_life_tracking: (v) => (v ? "shelf life tracked" : null),
  storage_condition: (v) => v,
  hsn_sac_code: (v) => `HSN/SAC ${v}`,
  alternate_brand_allowed: (v) => (v ? "alternate brand allowed" : "exact brand only"),
  asset_category: (v) => v,
  expected_useful_life_years: (v) => `useful life ${v} yrs`,
  warranty_months: (v) => `warranty ${v} mo`,
  installation_required: (v) => (v ? "installation + commissioning" : null),
  compliance_certifications: (v) => v.join("/") + " required",
  site_readiness: (v) => `site: ${v}`,
  training_required: (v) => (v ? "training required" : null),
  training_details: (v) => `training: ${v}`,
  spares_commitment_months: (v) => `spares commitment ${v} mo`,
  insurance_requirement: (v) => `insurance: ${v}`,
  amc_cmc_type: (v) => (v === "none" ? null : `${v.toUpperCase()}`),
  amc_cmc_procurement: (v) => (v === "bundled_with_purchase" ? "bundled" : "separate service tender"),
  default_tenure_months: (v) => `tenure ${v} mo`,
  renewal_terms: (v) => `renewal: ${v}`,
  sla_response_time_hours: (v) => `SLA ${v} h response`,
  sla_uptime_pct: (v) => `${v}% uptime`,
  sla_resolution_time_hours: (v) => `SLA ${v} h resolution`,
  sla_penalty_clauses: (v) => `LD: ${v}`,
  billing_basis: (v) => `${v} billing`,
  manpower_deployment_norms: (v) => v,
  exit_transition_clause: (v) => `exit terms: ${v}`,
  background_verification_required: (v) => (v ? "background verification required" : null),
  statutory_compliance_notes: (v) => `compliance: ${v}`,
  software_kind: (v) => (v === "development" ? "software development" : "software licensing"),
  license_type: (v) => `${v} licence`,
  deployment_model: (v) => `${v.replace("_", "-")} deployment`,
};

export function attrBits(p) {
  const bits = [];
  if (p.unit_of_measure) bits.push(`UoM ${p.unit_of_measure}`);
  if (p.regulatory_class) bits.push(p.regulatory_class);
  if (p.approved_brands.length) bits.push(`brands: ${p.approved_brands.join(", ")}`);
  if (p.reorder_level != null) bits.push(`reorder ${p.reorder_level}`);
  for (const [key, value] of Object.entries(p.type_specific_attrs || {})) {
    const fmt = LABELS[key];
    const text = fmt ? fmt(value) : `${key.replace(/_/g, " ")} ${value}`;
    if (text) bits.push(text);
  }
  if (p.min_mapping_rating != null) bits.push(`restricted: min rating ${p.min_mapping_rating}`);
  if (p.required_documents?.length) bits.push(`vendor must supply: ${p.required_documents.map(docLabel).join(", ")}`);
  return bits;
}

export function attrSummary(p) {
  return attrBits(p).join(" · ") || "—";
}

// Vendor-safe subset of attrSummary() (2026-10-01, user-directed): the
// vendor gets unit/regulatory/brand/type-specific facts only -- never
// reorder_level, price band, min_mapping_rating or required_documents (all
// staff-only internal inventory/budget/eligibility facts, not part of what's
// being procured). Deliberately its own "bits" assembly, not a filtered call
// into attrSummary(), so a future field added there can't leak here by
// accident -- this function simply never reads those fields at all.
export function vendorCatalogSpec(spec) {
  const bits = [];
  if (spec.unit_of_measure) bits.push(`UoM ${spec.unit_of_measure}`);
  if (spec.regulatory_class) bits.push(spec.regulatory_class);
  if (spec.approved_brands?.length) bits.push(`brands: ${spec.approved_brands.join(", ")}`);
  for (const [key, value] of Object.entries(spec.type_specific_attrs || {})) {
    const fmt = LABELS[key];
    const text = fmt ? fmt(value) : `${key.replace(/_/g, " ")} ${value}`;
    if (text) bits.push(text);
  }
  return bits.join(" · ") || "—";
}

export function priceBand(p) {
  if (p.price_band_min == null && p.price_band_max == null) return "—";
  return `${p.price_band_min != null ? inr(p.price_band_min) : "…"} – ${p.price_band_max != null ? inr(p.price_band_max) : "…"}`;
}
