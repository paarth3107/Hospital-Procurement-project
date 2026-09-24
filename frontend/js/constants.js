// Fixed checklist matching backend/app/models/vendor.py's VendorDocType +
// MANDATORY_DOC_TYPES exactly -- same reasoning as Category Declaration's
// move to a known set instead of free text. Shared by the vendor's own
// document upload page, the staff review panel, and the post-login router.
export const VENDOR_DOC_TYPES = [
  // Mandatory (spec 3.2 rows marked plain "Yes")
  { value: "gst_certificate", label: "GST Certificate", mandatory: true },
  { value: "pan_card", label: "PAN Card", mandatory: true },
  { value: "incorporation_certificate", label: "Certificate of Incorporation", mandatory: true },
  { value: "bank_proof", label: "Cancelled Cheque / Bank Letter", mandatory: true },
  { value: "sample_catalog", label: "Sample Product Catalog / Price List", mandatory: true, spreadsheet: true },
  // Statutory / compliance, "Yes (as applicable)": optional here, and they expire
  { value: "business_license", label: "Business Licence", mandatory: false },
  { value: "drug_license", label: "Drug Licence (pharma / consumables vendors)", mandatory: false },
  { value: "msme_udyam", label: "MSME / Udyam Registration", mandatory: false },
  { value: "iso_certificate", label: "ISO / Quality Certificate", mandatory: false },
];

// File types a document accepts (a catalogue / price list may be a spreadsheet).
export const acceptFor = (t) => (t.spreadsheet ? ".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" : ".pdf,.jpg,.jpeg,.png");

export const docLabel = (value) =>
  value.startsWith("other:") ? value.slice(6).trim() : VENDOR_DOC_TYPES.find((t) => t.value === value)?.label ?? value;

// One comparable key per required-document entry and per uploaded document
// (free-text "other" documents match case-insensitively by name).
export const entryKey = (entry) => (entry.startsWith("other:") ? "other:" + entry.slice(6).trim().toLowerCase() : entry);
export const docKey = (doc) => (doc.doc_type === "other" ? "other:" + doc.custom_label.trim().toLowerCase() : doc.doc_type);
