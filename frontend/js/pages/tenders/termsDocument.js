import { singleDocument } from "./singleDocument.js";

// The tender's Terms & Conditions document (2026-10-07, user-directed):
// payment terms, delivery terms, penalty clauses, validity period -- read
// from the actual document the officer uploads, not typed in. Mandatory
// before submission (tenders.py).
export const { render: renderTermsDocument, hasDocument: hasTermsDocument } = singleDocument({
  boxId: "terms-document-box",
  endpoint: "terms-document",
  fieldPrefix: "terms_document",
  slug: "terms",
  label: "Terms & Conditions document",
  requiredLabel: "Required before submission.",
});
