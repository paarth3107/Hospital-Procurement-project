import type { FieldDef } from "../../lib/formFields";
import type { ProcurementType } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/tenders/lineDetailFields.js -- spec
// §6.3.1-6.3.3 type-specific tender line-item fields, mirroring the catalog
// forms' field-description pattern (lib/formFields.ts) and
// app/schemas/line_details.py on the backend exactly. Rendered generically
// by the line-items grid (Stage 2).
//
// One generic "anything else" box, identical across all three types.
const COMMENTS_FIELD: FieldDef = { name: "comments", label: "Comments (optional)", kind: "textarea" };

// A delivery/installation date already in the past makes no sense for a
// tender that hasn't even been bid on yet (2026-10-28, user-directed) --
// optional either way (backend/app/schemas/line_details.py's delivery_date
// is nullable, spec never makes it mandatory), only checked when filled in.
const notInThePast = (value: string): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null; // the date picker already keeps malformed text out
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today ? "Can't be in the past." : null;
};

// hsn_sac_code and alternate_brand_allowed are deliberately NOT here -- both
// are fixed catalog classification facts (tax code; generic-substitution
// policy for this item), not things that vary per tender.
const ITEM_LINE_FIELDS: FieldDef[] = [
  { name: "delivery_date", label: "Required delivery date", kind: "date", validate: notInThePast },
  { name: "delivery_location", label: "Required delivery location", kind: "text" },
  COMMENTS_FIELD,
];

// required_certifications, warranty_requirement_months, brand_restriction,
// installation_notes, training_required/details, spares_commitment_months,
// insurance_requirement, and the AMC/CMC arrangement are deliberately NOT
// here -- they're all fixed facts about the asset itself (the read-only
// "Catalog spec" line shown above these fields pulls from the master item).
const ASSET_LINE_FIELDS: FieldDef[] = [
  { name: "exchange_buyback", label: "Old asset exchange / buy-back", kind: "bool" },
  { name: "exchange_asset_reference", label: "Reference asset ID being exchanged", kind: "text", showWhen: { exchange_buyback: "true" } },
  { name: "delivery_date", label: "Required delivery / installation date", kind: "date", validate: notInThePast },
  { name: "delivery_location", label: "Required delivery / installation location", kind: "text" },
  COMMENTS_FIELD,
];

// scope_of_work, SLA fields, billing_basis, manpower/background-verification
// fields, renewal/insurance/exit terms and license/IP terms are deliberately
// NOT here -- standing policy for the service category (catalog spec line),
// or already covered by the catalog's software-specific fields plus the
// vendor's own bid attachments. A Service line's mandatory SOW (spec §6.3.5)
// is enforced as a catalog-completeness check at submission, not asked
// again here.
const SERVICE_LINE_FIELDS: FieldDef[] = [
  { name: "tenure_months", label: "Service tenure/duration (months) — catalog default shown, override if this engagement differs", kind: "number" },
  { name: "service_locations", label: "Service location(s)", kind: "list" },
  COMMENTS_FIELD,
];

export const LINE_DETAIL_FIELDS_BY_TYPE: Record<ProcurementType, FieldDef[]> = {
  item: ITEM_LINE_FIELDS,
  asset: ASSET_LINE_FIELDS,
  service: SERVICE_LINE_FIELDS,
};
