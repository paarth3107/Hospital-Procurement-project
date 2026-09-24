import { inr } from "../../kit.js";

// One-line, human summary of a catalog entry's type-specific attributes and
// core details, for the master table's "Type-specific attributes" column.
const LABELS = {
  pack_size: (v) => `pack of ${v}`,
  shelf_life_tracking: (v) => (v ? "shelf life tracked" : null),
  storage_condition: (v) => v,
  asset_category: (v) => v,
  expected_useful_life_years: (v) => `useful life ${v} yrs`,
  warranty_months: (v) => `warranty ${v} mo`,
  installation_required: (v) => (v ? "installation + commissioning" : null),
  amc_cmc_applicable: (v) => (v ? "AMC/CMC applicable" : null),
  compliance_certifications: (v) => v.join("/") + " required",
  site_readiness: (v) => `site: ${v}`,
  default_tenure_months: (v) => `tenure ${v} mo`,
  sla_response_time_hours: (v) => `SLA ${v} h response`,
  sla_uptime_pct: (v) => `${v}% uptime`,
  sla_penalty_clauses: (v) => `LD: ${v}`,
  billing_basis: (v) => `${v} billing`,
  manpower_deployment_norms: (v) => v,
  software_kind: (v) => (v === "development" ? "software development" : "software licensing"),
  license_type: (v) => `${v} licence`,
  deployment_model: (v) => `${v.replace("_", "-")} deployment`,
};

export function attrSummary(p) {
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
  return bits.join(" · ") || "—";
}

export function priceBand(p) {
  if (p.price_band_min == null && p.price_band_max == null) return "—";
  return `${p.price_band_min != null ? inr(p.price_band_min) : "…"} – ${p.price_band_max != null ? inr(p.price_band_max) : "…"}`;
}
