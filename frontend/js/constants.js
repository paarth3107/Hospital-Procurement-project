// Fixed checklist matching backend/app/models/vendor.py's VendorDocType +
// MANDATORY_DOC_TYPES exactly -- same reasoning as Category Declaration's
// move to a known set instead of free text. Shared by the vendor's own
// document upload page, the staff review panel, and the post-login router.
export const VENDOR_DOC_TYPES = [
  // Mandatory (spec 3.2 rows marked plain "Yes") -- none of these expire.
  { value: "gst_certificate", label: "GST Certificate", mandatory: true },
  { value: "pan_card", label: "PAN Card", mandatory: true },
  { value: "incorporation_certificate", label: "Certificate of Incorporation", mandatory: true },
  { value: "bank_proof", label: "Cancelled Cheque / Bank Letter", mandatory: true },
  { value: "sample_catalog", label: "Sample Product Catalog / Price List", mandatory: true, spreadsheet: true },
  // Statutory / compliance, "Yes (as applicable)": optional here, and these do expire.
  { value: "business_license", label: "Business Licence", mandatory: false, expires: true },
  { value: "drug_license", label: "Drug Licence (pharma / consumables vendors)", mandatory: false, expires: true },
  { value: "msme_udyam", label: "MSME / Udyam Registration", mandatory: false, expires: true },
  { value: "iso_certificate", label: "ISO / Quality Certificate", mandatory: false, expires: true },
];

// File types a document accepts (a catalogue / price list may be a spreadsheet).
export const acceptFor = (t) => (t.spreadsheet ? ".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" : ".pdf,.jpg,.jpeg,.png");

export const docLabel = (value) =>
  value.startsWith("other:") ? value.slice(6).trim() : VENDOR_DOC_TYPES.find((t) => t.value === value)?.label ?? value;

// One comparable key per required-document entry and per uploaded document
// (free-text "other" documents match case-insensitively by name).
export const entryKey = (entry) => (entry.startsWith("other:") ? "other:" + entry.slice(6).trim().toLowerCase() : entry);
export const docKey = (doc) => (doc.doc_type === "other" ? "other:" + doc.custom_label.trim().toLowerCase() : doc.doc_type);

// Registration's location fields (2026-10-01): structured, not free text, so
// "vendors in a given state/city" is a real filter later instead of text
// someone would have to parse out of an address line by hand.
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
  "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal",
];

// A vendor can always fall back to "Other" and type their city -- this is a
// convenience list of major cities per state, not an exhaustive gazetteer.
// Cities within each state are alphabetical too.
export const CITIES_BY_STATE = {
  "Andhra Pradesh": ["Guntur", "Tirupati", "Vijayawada", "Visakhapatnam"],
  Assam: ["Dibrugarh", "Guwahati", "Silchar"],
  Bihar: ["Bhagalpur", "Gaya", "Patna"],
  Chandigarh: ["Chandigarh"],
  Delhi: ["Delhi", "New Delhi"],
  Goa: ["Margao", "Panaji"],
  Gujarat: ["Ahmedabad", "Rajkot", "Surat", "Vadodara"],
  Haryana: ["Faridabad", "Gurugram", "Panipat"],
  "Himachal Pradesh": ["Dharamshala", "Shimla"],
  Jharkhand: ["Dhanbad", "Jamshedpur", "Ranchi"],
  Karnataka: ["Bengaluru", "Hubballi", "Mangaluru", "Mysuru"],
  Kerala: ["Kochi", "Kozhikode", "Thiruvananthapuram"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur"],
  Maharashtra: ["Aurangabad", "Mumbai", "Nagpur", "Nashik", "Pune", "Thane"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela"],
  Punjab: ["Amritsar", "Chandigarh", "Ludhiana"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli"],
  Telangana: ["Hyderabad", "Nizamabad", "Warangal"],
  "Uttar Pradesh": ["Agra", "Kanpur", "Lucknow", "Noida", "Varanasi"],
  Uttarakhand: ["Dehradun", "Haridwar"],
  "West Bengal": ["Durgapur", "Howrah", "Kolkata", "Siliguri"],
  Puducherry: ["Puducherry"],
};

export const OTHER_CITY = "__other__";
