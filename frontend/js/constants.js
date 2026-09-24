// Fixed checklist matching backend/app/models/vendor.py's VendorDocType +
// MANDATORY_DOC_TYPES exactly -- same reasoning as Category Declaration's
// move to a known set instead of free text. Shared by the vendor's own
// document upload page, the staff review panel, and the post-login router.
export const VENDOR_DOC_TYPES = [
  { value: "gst_certificate", label: "GST Certificate", mandatory: true },
  { value: "pan_card", label: "PAN Card", mandatory: true },
  { value: "incorporation_certificate", label: "Certificate of Incorporation", mandatory: true },
  { value: "bank_proof", label: "Cancelled Cheque / Bank Proof", mandatory: false },
];
