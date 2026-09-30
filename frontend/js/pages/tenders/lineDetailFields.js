// Spec §6.3.1-6.3.3 type-specific tender line-item fields, mirroring the
// catalog forms' itemForm.js/assetForm.js/serviceForm.js field-description
// pattern (see ../catalog/formKit.js) and app/schemas/line_details.py on the
// backend exactly. Rendered generically by tenderLineItems.js.

// One generic "anything else" box, identical across all three types --
// replaces the old Item-only "technical_spec_override" framing (2026-10-01,
// user-directed: a plain comments field fits better than a fake "technical
// override," and there's no reason Asset/Service couldn't use the same thing).
const COMMENTS_FIELD = { name: "comments", label: "Comments (optional)", kind: "textarea" };

// hsn_sac_code and alternate_brand_allowed are deliberately NOT here -- both
// are fixed catalog classification facts (tax code; generic-substitution
// policy for this item), not things that vary per tender (2026-10-01,
// user-directed).
const ITEM_LINE_FIELDS = [
  { name: "delivery_date", label: "Required delivery date", kind: "date" },
  { name: "delivery_location", label: "Required delivery location", kind: "text" },
  COMMENTS_FIELD,
];

// required_certifications, warranty_requirement_months, brand_restriction,
// installation_notes, training_required/details, spares_commitment_months,
// insurance_requirement, and the AMC/CMC arrangement are deliberately NOT
// here -- they're all fixed facts about the asset itself (see the read-only
// "Catalog spec" line above these fields). Pull from the master item; only
// ask what it can't answer.
const ASSET_LINE_FIELDS = [
  { name: "exchange_buyback", label: "Old asset exchange / buy-back", kind: "bool" },
  { name: "exchange_asset_reference", label: "Reference asset ID being exchanged", kind: "text", showWhen: { exchange_buyback: "true" } },
  { name: "delivery_date", label: "Required delivery / installation date", kind: "date" },
  { name: "delivery_location", label: "Required delivery / installation location", kind: "text" },
  COMMENTS_FIELD,
];

// scope_of_work, sla_response_time_hours, sla_uptime_pct, sla_resolution_time_hours,
// sla_penalty_clauses, billing_basis, manpower_deployment_norms,
// background_verification_required, statutory_compliance_notes,
// renewal_terms, insurance_requirement, exit_transition_clause and
// license_ip_terms_notes are deliberately NOT here -- they're all standing
// policy for this service category (see the read-only "Catalog spec" line
// above these fields), or (license_ip_terms_notes) are already fully covered
// by the catalog's software-specific fields plus the vendor's own bid
// attachments. A Service line's mandatory SOW (spec §6.3.5) is enforced as a
// catalog-completeness check at submission, not asked again here.
const SERVICE_LINE_FIELDS = [
  { name: "tenure_months", label: "Service tenure/duration (months) — catalog default shown, override if this engagement differs", kind: "number" },
  { name: "service_locations", label: "Service location(s)", kind: "list" },
  COMMENTS_FIELD,
];

export const LINE_DETAIL_FIELDS_BY_TYPE = {
  item: ITEM_LINE_FIELDS,
  asset: ASSET_LINE_FIELDS,
  service: SERVICE_LINE_FIELDS,
};
