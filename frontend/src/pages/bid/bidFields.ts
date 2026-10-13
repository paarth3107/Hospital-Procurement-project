import type { FieldDef } from "../../lib/formFields";
import type { ProcurementType } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/bid/bidFields.js -- spec §8.2's
// type-specific bid technical answers, mirroring the tender line-item
// field-description pattern (tenders/lineDetailFields.ts) and
// app/schemas/bid.py's ItemDetails/AssetDetails/ServiceDetails exactly.
// Rendered generically by BidLineItemsGrid's per-row Details expansion.
export const BID_DETAIL_FIELDS_BY_TYPE: Record<ProcurementType, FieldDef[]> = {
  item: [{ name: "shelf_life_months", label: "Shelf life remaining at delivery (months)", kind: "number" }],
  asset: [
    { name: "warranty_months", label: "Warranty (months)", kind: "number" },
    { name: "spares_commitment_years", label: "Spare-parts / service commitment (years)", kind: "number" },
    { name: "installation_included", label: "Installation & commissioning included", kind: "bool" },
    { name: "training_included", label: "User / biomedical training included", kind: "bool" },
    { name: "bidding_as_distributor", label: "Bidding as a distributor (manufacturer authorization letter required)", kind: "bool" },
  ],
  service: [
    { name: "sow_response", label: "Proposed scope of work / method statement", kind: "textarea" },
    { name: "manpower_plan", label: "Manpower deployment plan", kind: "textarea" },
    { name: "sla_commitment", label: "SLA commitment", kind: "textarea" },
  ],
};
