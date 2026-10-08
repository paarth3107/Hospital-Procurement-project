import { singleDocument } from "./singleDocument.js";

// The signed Rate Contract agreement (2026-10-07, user-directed) -- only
// meaningful while the tender's "Rate contract" flag is on. Mandatory before
// submission once that flag is set (tenders.py).
export const { render: renderRateContractDocument, hasDocument: hasRateContractDocument } = singleDocument({
  boxId: "rate-contract-document-box",
  endpoint: "rate-contract-document",
  fieldPrefix: "rate_contract_document",
  slug: "rate-contract",
  label: "Rate Contract agreement",
  requiredLabel: "Required before submission.",
  noTenderHint: false,
});
