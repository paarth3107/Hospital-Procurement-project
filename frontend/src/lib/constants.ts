// Ported from frontend/js/constants.js's VENDOR_DOC_TYPES -- must match
// backend/app/models/vendor.py's VendorDocType + MANDATORY_DOC_TYPES exactly.
export interface VendorDocTypeDef {
  value: string;
  label: string;
  mandatory: boolean;
  expires?: boolean;
  spreadsheet?: boolean;
}

// File types a document accepts (a catalogue / price list may be a spreadsheet).
export const acceptFor = (t: VendorDocTypeDef): string => (t.spreadsheet ? ".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" : ".pdf,.jpg,.jpeg,.png");

export const VENDOR_DOC_TYPES: VendorDocTypeDef[] = [
  { value: "gst_certificate", label: "GST Certificate", mandatory: true },
  { value: "pan_card", label: "PAN Card", mandatory: true },
  { value: "incorporation_certificate", label: "Certificate of Incorporation", mandatory: true },
  { value: "bank_proof", label: "Cancelled Cheque / Bank Letter", mandatory: true },
  { value: "sample_catalog", label: "Sample Product Catalog / Price List", mandatory: true, spreadsheet: true },
  { value: "business_license", label: "Business Licence", mandatory: false, expires: true },
  { value: "drug_license", label: "Drug Licence (pharma / consumables vendors)", mandatory: false, expires: true },
  { value: "msme_udyam", label: "MSME / Udyam Registration", mandatory: false, expires: true },
  { value: "iso_certificate", label: "ISO / Quality Certificate", mandatory: false, expires: true },
];

// Ported from constants.js's docLabel -- a "required document" entry is
// either a standard VENDOR_DOC_TYPES value or "other:<free text>" naming one
// a reviewer reads and verifies, not a fixed type.
export const docLabel = (value: string): string =>
  value.startsWith("other:") ? value.slice(6).trim() : VENDOR_DOC_TYPES.find((t) => t.value === value)?.label ?? value;

// One comparable key per required-document entry and per uploaded document
// (free-text "other" documents match case-insensitively by name) -- ported
// from constants.js's entryKey/docKey, used by the Mapping detail dialog to
// match a category/item's required_documents against a vendor's uploads.
export const entryKey = (entry: string): string => (entry.startsWith("other:") ? "other:" + entry.slice(6).trim().toLowerCase() : entry);
export const docKey = (doc: { doc_type: string; custom_label: string }): string =>
  doc.doc_type === "other" ? "other:" + doc.custom_label.trim().toLowerCase() : doc.doc_type;

// Which nav tabs/routes are useful to each role, driven by what that role
// can actually do server-side (see backend/README.md's role tables) -- not
// just "logged in staff sees everything". The ONE canonical copy as of the
// Final Phase (2026-10-12) -- this used to mirror frontend/js/nav.js's own
// ROLE_TABS (a plain duplicate, since nav.js's vanilla sidebar was the real
// source of truth); now that the sidebar/router are React too, this IS the
// source of truth, consulted both by the router's role-gate and by the
// dashboard's Action Queue (to skip a task whose target page this role's
// sidebar wouldn't even show).
export const CATALOG_VIEWS = ["catalog-list", "catalog-add", "catalog-categories", "catalog-subcategories"];
export const MAPPING_VIEWS = ["mappings-matrix", "mappings-requests"];
export const ROLE_TABS: Record<string, string[]> = {
  procurement_officer: ["dashboard", "tenders", "evaluation", "awards"],
  category_manager: ["dashboard", "queue", ...CATALOG_VIEWS, ...MAPPING_VIEWS, "ratings", "evaluation", "pofiles", "decisions"],
  approving_authority: ["dashboard", "approvals", "awards", "decisions"],
  system_admin: ["dashboard", "queue", ...CATALOG_VIEWS, ...MAPPING_VIEWS, "ratings", "tenders", "evaluation", "awards", "pofiles", "approvals", "staff", "audit", "decisions"],
};

export const ALL_STAFF_TAB_VIEWS = [
  "dashboard", "queue", ...CATALOG_VIEWS, ...MAPPING_VIEWS, "ratings", "tenders", "evaluation", "awards", "pofiles", "approvals", "staff", "audit", "decisions",
];

// Picks where to land after a successful staff login, and where a role-
// gated route redirects a role that has no tab for it. The canonical copy
// (used to mirror nav.js's DEFAULT_VIEW_BY_ROLE).
export const DEFAULT_VIEW_BY_ROLE: Record<string, string> = {
  procurement_officer: "dashboard",
  category_manager: "dashboard",
  approving_authority: "dashboard",
  system_admin: "dashboard",
};

// Sidebar structure (frontend/index.html's grouped nav, ported): the four
// always-visible items (role-filtered individually) plus three collapsible
// groups. One view per row; `icon` matches lib/icons.tsx's PATHS keys.
export interface NavItem {
  view: string;
  label: string;
  icon: string;
  badge?: "queue" | "mappings" | "approvals" | "awards" | "decisions" | "vendor-categories" | "vendor-dashboard";
}
export const NAV_TOP: NavItem[] = [
  { view: "dashboard", label: "Dashboard", icon: "dashboard" },
  { view: "decisions", label: "Decisions", icon: "check-square", badge: "decisions" },
];
export const NAV_VENDOR_TOP: NavItem[] = [
  { view: "vendor-dashboard", label: "Dashboard", icon: "home", badge: "vendor-dashboard" },
  { view: "vendor-profile", label: "Company Profile", icon: "user" },
  { view: "vendor-categories", label: "Category Declaration", icon: "tag", badge: "vendor-categories" },
];
export const NAV_GROUPS: { key: string; label: string; icon: string; items: NavItem[] }[] = [
  {
    key: "vendors",
    label: "Vendors",
    icon: "users",
    items: [
      { view: "queue", label: "Vendor List", icon: "user-check", badge: "queue" },
      { view: "mappings-matrix", label: "Mapping Matrix", icon: "layers" },
      { view: "mappings-requests", label: "Mapping Requests", icon: "user-check", badge: "mappings" },
      { view: "ratings", label: "Ratings & Scorecards", icon: "star" },
    ],
  },
  {
    key: "catalog",
    label: "Catalog",
    icon: "package",
    items: [
      { view: "catalog-list", label: "Product List", icon: "package" },
      { view: "catalog-add", label: "Add Product", icon: "upload" },
      { view: "catalog-categories", label: "Category List", icon: "tag" },
      { view: "catalog-subcategories", label: "Sub-Category List", icon: "layers" },
    ],
  },
  {
    key: "tenders",
    label: "Tenders",
    icon: "file-text",
    items: [
      { view: "tenders", label: "Tender Creation", icon: "file-text" },
      { view: "approvals", label: "E-Tender Approval", icon: "check-square", badge: "approvals" },
      { view: "evaluation", label: "Bid Evaluation", icon: "bar-chart" },
      { view: "awards", label: "L1 Award", icon: "award", badge: "awards" },
      { view: "pofiles", label: "PO Data Files", icon: "file" },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    icon: "shield",
    items: [
      { view: "staff", label: "Staff Accounts", icon: "briefcase" },
      { view: "audit", label: "Audit Log", icon: "activity" },
    ],
  },
];

// Spec §12.3's 8 override types, human-readable -- shared by the Decisions
// page and the dashboard's Action Queue so a pending decision reads the same
// wherever it shows up.
export const OVERRIDE_TYPE_LABELS: Record<string, string> = {
  price_competitiveness_override: "Price Competitiveness Override",
  invite_list_manual_add: "Invite List Manual Add",
  guest_vendor_invite: "Expedited Registration Review",
  technical_score_correction: "Technical Score Correction",
  late_submission_exception: "Late-Submission Exception",
  due_date_extension: "Bid Due-Date Extension",
  non_l1_award_override: "Non-L1 Award Override",
  po_reexport: "PO Re-export",
};

// frontend/js/nav.js's PAGE_TITLES, ported -- the page head's kicker+title
// per view (sub-screens with no tab of their own, tender-edit/vendor-view,
// share their parent's).
export const PAGE_TITLES: Record<string, [string, string]> = {
  dashboard: ["Overview", "Dashboard"],
  queue: ["", "Vendor List"],
  "vendor-view": ["", "Vendor Profile"],
  "catalog-list": ["", "Product List"],
  "catalog-add": ["", "Add Product"],
  "catalog-categories": ["", "Category List"],
  "catalog-subcategories": ["", "Sub-Category List"],
  "mappings-matrix": ["", "Mapping Matrix"],
  "mappings-requests": ["", "Mapping Requests"],
  ratings: ["", "Vendor Rating & Scorecard"],
  tenders: ["", "E-Tender Creation"],
  "tender-edit": ["", "E-Tender Creation"],
  approvals: ["", "E-Tender Approval"],
  staff: ["Administration", "Staff Accounts"],
  audit: ["Administration", "Audit Log"],
  bid: ["Vendor Portal", "Prepare Bid"],
  evaluation: ["", "Bid Evaluation"],
  awards: ["", "L1 Recommendation & Approval"],
  pofiles: ["", "PO Data Files For The ERP"],
  decisions: ["", "Decisions"],
  "vendor-dashboard": ["Vendor Portal", "Dashboard"],
  "vendor-profile": ["", "Company Profile & Documents"],
  "vendor-categories": ["", "Category Declaration"],
};

// Ported from frontend/js/constants.js -- registration's location fields
// (2026-10-01): structured, not free text, so "vendors in a given
// state/city" is a real filter later instead of text someone would have to
// parse out of an address line by hand. A vendor can always fall back to
// "Other" and type their city -- this is a convenience list of major cities
// per state, not an exhaustive gazetteer. Cities within each state are
// alphabetical too.
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
  "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal",
];

export const CITIES_BY_STATE: Record<string, string[]> = {
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
