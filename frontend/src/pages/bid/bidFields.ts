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
  // sow_response/manpower_plan removed (2026-10-28, user-directed: "if the
  // SOW is in a document why do we need a separate SOW statement?") --
  // both duplicated a mandatory document-upload slot that already exists
  // for the same thing (BidAttachmentKind.SOW_METHOD/MANPOWER_PLAN,
  // services/bids.py). sla_commitment stays -- there's no matching
  // attachment kind for it, this textarea is its only real home.
  service: [{ name: "sla_commitment", label: "SLA commitment", kind: "textarea" }],
};
