import { docLabel } from "./constants";
import type { CatalogProduct, CatalogSpec } from "./types";

// Ported from frontend/js/pages/catalog/attrSummary.js's attrBits()/
// attrSummary()/vendorCatalogSpec() -- a one-line, human summary of a
// catalog entry's type-specific attributes and core details. attrSummary()
// is used by the tender line-items grid's Details expansion as a read-only
// "Catalog spec (reference)" line; vendorCatalogSpec() is the vendor-safe
// subset (no reorder_level/price band/min rating/required_documents --
// staff-only internal facts, not part of what's being procured) used by
// the vendor's own bid grid. (The vanilla file itself is untouched --
// still needed by bid/bidLineItems.js and tenders/tenderLineItems.js, not
// deleted.)
type AttrFormatter = (v: unknown) => string | null;

const LABELS: Record<string, AttrFormatter> = {
  pack_size: (v) => `pack of ${v}`,
  shelf_life_tracking: (v) => (v ? "shelf life tracked" : null),
  storage_condition: (v) => String(v),
  hsn_sac_code: (v) => `HSN/SAC ${v}`,
  alternate_brand_allowed: (v) => (v ? "alternate brand allowed" : "exact brand only"),
  asset_category: (v) => String(v),
  expected_useful_life_years: (v) => `useful life ${v} yrs`,
  warranty_months: (v) => `warranty ${v} mo`,
  installation_required: (v) => (v ? "installation + commissioning" : null),
  compliance_certifications: (v) => (v as string[]).join("/") + " required",
  site_readiness: (v) => `site: ${v}`,
  training_required: (v) => (v ? "training required" : null),
  training_details: (v) => `training: ${v}`,
  spares_commitment_months: (v) => `spares commitment ${v} mo`,
  insurance_requirement: (v) => `insurance: ${v}`,
  amc_cmc_type: (v) => (v === "none" ? null : `${String(v).toUpperCase()}`),
  amc_cmc_procurement: (v) => (v === "bundled_with_purchase" ? "bundled" : "separate service tender"),
  default_tenure_months: (v) => `tenure ${v} mo`,
  renewal_terms: (v) => `renewal: ${v}`,
  sla_response_time_hours: (v) => `SLA ${v} h response`,
  sla_uptime_pct: (v) => `${v}% uptime`,
  sla_resolution_time_hours: (v) => `SLA ${v} h resolution`,
  sla_penalty_clauses: (v) => `LD: ${v}`,
  billing_basis: (v) => `${v} billing`,
  manpower_deployment_norms: (v) => String(v),
  exit_transition_clause: (v) => `exit terms: ${v}`,
  background_verification_required: (v) => (v ? "background verification required" : null),
  statutory_compliance_notes: (v) => `compliance: ${v}`,
  software_kind: (v) => (v === "development" ? "software development" : "software licensing"),
  license_type: (v) => `${v} licence`,
  deployment_model: (v) => `${String(v).replace("_", "-")} deployment`,
};

export function attrBits(p: CatalogProduct): string[] {
  const bits: string[] = [];
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

export const attrSummary = (p: CatalogProduct): string => attrBits(p).join(" · ") || "—";

// Vendor-safe subset of attrSummary() -- deliberately its own "bits"
// assembly, not a filtered call into attrBits(), so a future field added
// there can't leak here by accident: this function simply never reads
// reorder_level/price band/min_mapping_rating/required_documents at all.
export function vendorCatalogSpec(spec: CatalogSpec): string {
  const bits: string[] = [];
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
