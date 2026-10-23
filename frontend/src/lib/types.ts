// Mirrors backend/app/schemas/audit.py exactly.

export interface AuditLogRow {
  id: number;
  occurred_at: string;
  actor_type: string;
  actor_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  entity_label: string | null;
  facility_id: number | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
  imported: boolean;
}

export interface AuditLogPageData {
  items: AuditLogRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditFilterOptions {
  entity_types: string[];
  actions: string[];
}

export interface AuditFilters {
  entity_type: string;
  action: string;
  actor_type: string;
  date_from: string;
  date_to: string;
  search: string;
}

export const EMPTY_FILTERS: AuditFilters = { entity_type: "", action: "", actor_type: "", date_from: "", date_to: "", search: "" };

// Mirrors backend/app/schemas/staff.py + facility.py.

export type Role = "procurement_officer" | "category_manager" | "approving_authority" | "system_admin";

export interface StaffUser {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  facility_id: number | null;
  approval_tier: number | null;
  is_active: boolean;
  created_at: string | null;
}

export interface Facility {
  id: number;
  name: string;
  legal_entity_code: string;
}

export interface StaffCreatePayload {
  email: string;
  full_name: string;
  role: Role;
  facility_id: number | null;
  approval_tier: number | null;
  password: string;
}

export interface StaffUpdatePayload {
  full_name: string;
  role: Role;
  facility_id: number | null;
  approval_tier: number | null;
}

// Mirrors backend/app/schemas/auth.py's CurrentUser.
export interface CurrentUser {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  approval_tier: number | null;
  facility_id: number | null;
}

// Mirrors backend/app/schemas/rating.py + vendor.py's VendorLookupOut.
export type ProcurementType = "item" | "asset" | "service";

export interface VendorLookup {
  id: number;
  legal_name: string;
  status: string;
}

export interface Rating {
  id: number;
  vendor_id: number;
  procurement_type: ProcurementType;
  price_competitiveness: number | null;
  on_time_pct: number | null;
  quality_pct: number | null;
  compliance_pct: number | null;
  responsiveness: number | null;
  overall_score: number;
  // No separate "Provisional" state (2026-10-23, user-directed, matching
  // spec exactly) -- a vendor is either Unrated (true here requires BOTH
  // real price history AND at least one manual entry, not just one field)
  // or rated on whatever real data exists.
  is_unrated: boolean;
  is_stale: boolean;
  last_manual_update_at: string | null;
  created_at: string;
}

export interface RatingHistoryEntry {
  id: number;
  field: string;
  old_value: number | null;
  new_value: number;
  comment: string | null;
  entered_by_id: number | null;
  entered_at: string;
}

// Mirrors backend/app/schemas/vendor.py's VendorOut -- only the fields the
// ported pages actually use so far, not the full registration record.
export type VendorStatus = "draft" | "pending_verification" | "info_requested" | "active" | "suspended" | "rejected" | "blacklisted";

export interface VendorListItem {
  id: number;
  status: VendorStatus;
  legal_name: string;
  contact_person: string;
  created_at: string;
  expedited_review_tender_id: number | null;
}

// Mirrors backend/app/schemas/vendor.py's VendorOut (full detail, Vendor View).
export interface VendorDetail {
  id: number;
  status: VendorStatus;
  legal_name: string;
  gstin: string;
  pan: string | null;
  trade_name: string | null;
  entity_type: string | null;
  year_of_incorporation: number | null;
  registered_address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  branch_locations: string | null;
  alternate_address: string | null;
  website: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  contact_person: string;
  contact_designation: string | null;
  email: string;
  phone: string | null;
  escalation_contact_name: string | null;
  escalation_contact_phone: string | null;
  escalation_contact_email: string | null;
  payment_terms: string | null;
  delivery_lead_time_days: number | null;
  min_order_value: number | null;
  category_declaration: string | null;
  rejection_reason: string | null;
  created_at: string;
  // Added 2026-10-21 for registration recovery -- registration_token is
  // only ever non-null while status is "draft" (backend nulls it out
  // otherwise, see schemas/vendor.py's VendorOut.hide_token_once_not_draft).
  registration_token: string | null;
  email_verified: boolean;
  // Spec §6.7/§12.3 Expedited Registration Review -- set once that override
  // is Approved (backend/app/routers/vendors.py's approve_expedited_review).
  expedited_review_tender_id: number | null;
}

// Mirrors backend/app/schemas/vendor_document.py (and models/vendor.py's
// DocumentStatus, which this was missing "draft" from until Phase 10b --
// a document sitting in the vendor's own document vault, uploaded but not
// yet submitted, is draft until a "Submit documents" action promotes it).
export type DocumentStatus = "draft" | "pending" | "verified" | "rejected";
export interface VendorDocument {
  id: number;
  vendor_id: number;
  doc_type: string;
  custom_label: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  status: DocumentStatus;
  rejection_reason: string | null;
  uploaded_at: string;
  valid_till: string | null;
  expiry_state: string; // "" | "expiring" | "expired"
}

export interface RequiredDocument {
  entry: string;
  label: string;
  state: string;
  doc_id: number | null;
  reason: string | null;
}

export interface ItemRequirement {
  product_id: number;
  product_code: string;
  product_name: string;
  category: string;
  source: "category" | "item";
  mapping_state: string;
  summary: "verified" | "documents_needed" | "awaiting_verification";
  documents: RequiredDocument[];
}

// Mirrors backend/app/schemas/vendor.py's VendorHistoryEntryOut exactly
// (2026-10-14) -- a merged status-transition OR document-event row (label
// set for the latter, from_status/to_status set for the former), since the
// vendor profile's "Status History" now shows both in one timeline.
export interface VendorStatusHistoryEntry {
  id: string;
  at: string;
  from_status: VendorStatus | null;
  to_status: VendorStatus | null;
  label: string | null;
  reason: string | null;
}

// Mirrors backend/app/schemas/staff_notification.py's StaffNotificationOut
// -- a staff user's own short, informational messages (first use: told once
// an override they requested is approved/rejected).
export interface StaffNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read: boolean;
}

// Mirrors backend/app/schemas/override.py's OverrideOut -- minimal slice
// actually used so far (VendorViewPage's Expedited Registration Review
// banner). No module surfaced overrides in the UI before this.
export interface OverrideOut {
  id: number;
  override_type: string;
  entity_id: number | null;
  entity_label: string | null;
  initiator_role: string;
  reason_code: string;
  justification: string;
  status: string;
  required_approver_role: string | null;
  required_approver_min_tier: number | null;
  created_at: string;
}

// Mirrors backend/app/schemas/product.py's CategoryOut/SubCategoryOut/ProductOut
// and backend/app/schemas/mapping.py's MappingOut -- the Catalog screens
// (Product List, Add Product, Category List, Sub-Category List).
export interface Category {
  id: number;
  name: string;
  procurement_type: ProcurementType;
  min_mapping_rating: number | null;
  required_documents: string[];
  active: boolean;
}

export interface SubCategory {
  id: number;
  name: string;
  category_id: number;
  active: boolean;
}

export interface CatalogProduct {
  id: number;
  code: string;
  name: string;
  description: string | null;
  procurement_type: ProcurementType;
  category_id: number;
  category: string;
  sub_category_id: number | null;
  sub_category: string | null;
  unit_of_measure: string | null;
  regulatory_class: string | null;
  approved_brands: string[];
  reorder_level: number | null;
  price_band_min: number | null;
  price_band_max: number | null;
  min_mapping_rating: number | null;
  required_documents: string[];
  type_specific_attrs: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export type MappingState = "pending" | "approved" | "rejected" | "suspended";

export interface VendorMapping {
  id: number;
  vendor_id: number;
  product_master_id: number | null;
  category_id: number | null;
  state: MappingState;
  requested_at: string;
  decided_by_id: number | null;
  decided_at: string | null;
  version: number;
}

// Mirrors backend/app/schemas/mapping.py's MappingHistoryOut.
export interface MappingHistoryEntry {
  id: number;
  from_state: MappingState | null;
  to_state: MappingState;
  reason: string | null;
  actor_id: number | null;
  at: string;
}

// Mirrors backend/app/routers/po_files.py's _brief() dict exactly (list
// endpoint has no Pydantic response_model, so this is read straight off the
// handler's return shape, same as the vanilla page already did).
export interface PoDataFile {
  id: number;
  batch_id: string;
  tender_id: number;
  tender_title: string;
  vendor_id: number;
  vendor_name: string;
  vendor_code: string;
  version: number;
  status: string;
  lines: number;
  total_incl_tax: number;
  generated_at: string;
  approved_by: string;
  erp_po_number: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  supersedes_id: number | null;
}

// Mirrors backend/app/schemas/tender.py's TenderOut exactly.
export type TenderType = "rfq" | "rfp";
export type TenderStatus = "draft" | "pending_approval" | "scheduled" | "published" | "withdrawn" | "no_award" | "awarded";

export interface Tender {
  id: number;
  facility_id: number | null;
  title: string;
  description: string | null;
  tender_type: TenderType;
  status: TenderStatus;
  department: string | null;
  min_rating_threshold: number;
  min_invites: number | null;
  max_invites: number | null;
  open_tender: boolean;
  open_link_token: string | null;
  is_rate_contract: boolean;
  contract_start_date: string | null;
  contract_end_date: string | null;
  rate_contract_document_filename: string | null;
  rate_contract_document_size: number | null;
  rate_contract_document_uploaded_at: string | null;
  publish_date: string | null;
  bid_due_date: string | null;
  terms_document_filename: string | null;
  terms_document_size: number | null;
  terms_document_uploaded_at: string | null;
  published_at: string | null;
  round_number: number;
  created_at: string;
}

// Mirrors backend/app/schemas/tender.py's LineAttachmentOut/LineItemOut/
// EligibleVendorOut exactly.
export type TechnicalEvalMethod = "qualify_disqualify" | "scored" | "qcbs";
export type TenderLineAttachmentKind = "sow_document" | "technical_spec_sheet" | "engineering_drawing" | "reference_image" | "other";

export interface LineAttachment {
  id: number;
  kind: TenderLineAttachmentKind;
  custom_label: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface LineItem {
  id: number;
  tender_id: number;
  product_master_id: number;
  procurement_type: ProcurementType;
  qty: number | null;
  estimated_price: number | null;
  split_award_allowed: boolean;
  published: boolean;
  min_rating_threshold_override: number | null;
  technical_eval_method: TechnicalEvalMethod;
  technical_weight: number | null;
  price_weight: number | null;
  line_details: Record<string, unknown>;
  attachments: LineAttachment[];
  created_at: string;
}

// Mirrors backend/app/schemas/tender.py's EligibleVendorOut/ExcludedVendorOut/
// LineItemEligibilityOut/ApprovalRoundOut exactly.
export interface EligibleVendor {
  vendor_id: number;
  legal_name: string;
  rating_score: number;
  is_unrated: boolean;
  source: "system" | "open" | "manual";
  reason: string | null;
}

export interface ExcludedVendor {
  vendor_id: number;
  legal_name: string;
  reason: string;
}

export interface LineItemEligibility {
  line_item_id: number;
  product_name: string;
  product_master_id: number;
  threshold_applied: number;
  eligible_vendors: EligibleVendor[];
  removed_vendors: ExcludedVendor[];
  // Every currently-Active vendor id that's unrated for this line's
  // procurement_type (2026-10-23) -- for the Manual Invite picker, whose
  // candidate pool is every Active vendor, not just eligible_vendors.
  unrated_vendor_ids: number[];
}

export type RoundDecision = "pending" | "approved" | "rejected";

export interface ApprovalRound {
  id: number;
  round_number: number;
  decision: RoundDecision;
  required_tier: number;
  submitted_by_id: number | null;
  submitted_at: string;
  reviewer_id: number | null;
  comments: string | null;
  decided_at: string | null;
}

// Mirrors backend/app/schemas/tender_review.py's ReviewVendorOut/
// ReviewLineOut/ReviewRoundOut/TenderReviewOut exactly.
export interface ReviewVendor {
  vendor_id: number;
  legal_name: string;
  rating_score: number;
  is_unrated: boolean;
}

export interface ReviewLine {
  line_item_id: number;
  product_code: string;
  product_name: string;
  category: string;
  procurement_type: ProcurementType;
  regulatory_class: string | null;
  uom: string | null;
  qty: number;
  estimated_price: number | null;
  line_value: number | null;
  split_award_allowed: boolean;
  technical_eval_method: TechnicalEvalMethod;
  technical_weight: number | null;
  price_weight: number | null;
  min_rating_applied: number;
  line_details: Record<string, unknown>;
  catalog_attrs: Record<string, unknown>;
  required_documents: string[];
  eligible_vendors: ReviewVendor[];
  held_back: boolean;
}

export interface ReviewRound {
  round_number: number;
  decision: RoundDecision;
  required_tier: number;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewer: string | null;
  decided_at: string | null;
  comments: string | null;
}

export interface TenderReview {
  id: number;
  title: string;
  description: string | null;
  tender_type: TenderType;
  status: TenderStatus;
  department: string | null;
  facility_name: string;
  facility_code: string | null;
  min_rating_threshold: number;
  min_invites: number | null;
  max_invites: number | null;
  open_tender: boolean;
  is_rate_contract: boolean;
  contract_start_date: string | null;
  contract_end_date: string | null;
  rate_contract_document_filename: string | null;
  publish_date: string | null;
  bid_due_date: string | null;
  terms_document_filename: string | null;
  created_by: string | null;
  created_at: string;
  round_number: number;
  consecutive_rejections: number;
  total_estimated_value: number;
  lines_without_price: number;
  required_tier: number | null;
  tier_label: string | null;
  escalated: boolean;
  can_decide: boolean;
  warnings: string[];
  rounds: ReviewRound[];
  lines: ReviewLine[];
}

// Mirrors backend/app/schemas/evaluation.py exactly.
export type TechnicalDecision = "qualified" | "disqualified";
export type BidAttachmentKind = string;

export interface LineSummary {
  line_item_id: number;
  tender_id: number;
  tender_title: string;
  tender_type: TenderType;
  tender_status: TenderStatus;
  product_name: string;
  procurement_type: ProcurementType;
  qty: number;
  bid_due_date: string | null;
  technical_eval_method: TechnicalEvalMethod;
  phase: "bidding_open" | "technical_evaluation" | "technical_closed";
  invited_count: number;
  submitted_count: number;
  evaluated_count: number;
}

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  auto: boolean;
  optional: boolean;
}

export interface AttachmentMeta {
  id: number;
  kind: BidAttachmentKind;
  label: string;
  original_filename: string;
  size_bytes: number;
  description: string | null;
}

export interface Evaluation {
  evaluator: string;
  mine: boolean;
  decision: TechnicalDecision;
  scores: Record<string, number | null>;
  weighted_score: number | null;
  comments: string | null;
}

export interface EvaluationResult {
  outcome: TechnicalDecision;
  consolidated_score: number | null;
  t_rank: number | null;
  reason: string | null;
}

export interface ReviewAttachment extends AttachmentMeta {
  opened: boolean;
}

export interface BidReview {
  bid_id: number;
  vendor_name: string;
  rating: number;
  brand_offered: string | null;
  compliant_full: boolean;
  technical_compliance: string | null;
  details: Record<string, unknown>;
  attachments: ReviewAttachment[];
  all_opened: boolean;
  criteria: Criterion[];
  min_technical_score: number;
  scored: boolean;
  my_evaluation: Evaluation | null;
}

export interface VendorBidRow {
  vendor_id: number;
  vendor_name: string;
  rating: number;
  submitted: boolean;
  submitted_at: string | null;
  bid_id: number | null;
  evaluations: Evaluation[];
  evaluation_count: number;
  result: EvaluationResult | null;
}

// Spec §8.4 -- a bid held as BidStatus.PENDING_LATE_EXCEPTION (not SUBMITTED,
// so it's never in `vendors` above). See backend/app/schemas/evaluation.py's
// LateSubmissionOut.
export interface LateSubmission {
  bid_id: number;
  vendor_id: number;
  vendor_name: string;
  submitted_at: string | null;
  override_id: number | null;
  override_status: string | null;
  can_request: boolean;
}

export interface LineDetail {
  summary: LineSummary;
  criteria: Criterion[];
  min_technical_score: number;
  scored: boolean;
  can_evaluate: boolean;
  can_see_evaluations: boolean;
  technical_closed_at: string | null;
  vendors: VendorBidRow[];
  late_submissions: LateSubmission[];
}

export interface TenderEvalSummary {
  tender_id: number;
  tender_title: string;
  tender_type: TenderType;
  tender_status: TenderStatus;
  facility_name: string;
  bid_due_date: string | null;
  line_count: number;
  submitted_count: number;
  evaluated_count: number;
  open_count: number;
}

export interface TenderEvalDetail {
  tender_id: number;
  tender_title: string;
  tender_type: TenderType;
  tender_status: TenderStatus;
  facility_name: string;
  bid_due_date: string | null;
  lines: LineDetail[];
}

export interface CommercialRow {
  vendor_id: number;
  vendor_name: string;
  bid_id: number;
  technical_outcome: TechnicalDecision;
  technical_score: number | null;
  t_rank: number | null;
  technical_reason: string | null;
  rating: number;
  rank: number | null;
  rank_label: string | null;
  recommended: boolean;
  unit_price: number | null;
  gst_percent: number | null;
  other_duties: number | null;
  landed_unit_price: number | null;
  total_price: number | null;
  landed_total: number | null;
  delivery_lead_days: number | null;
  quote_validity_days: number | null;
  payment_terms: string | null;
  price_score: number | null;
  combined_score: number | null;
  variance_pct: number | null;
  price_flags: string[];
  tie_note: string | null;
  submitted_at: string | null;
}

export interface CommercialStatement {
  summary: LineSummary;
  method: "L1" | "QCBS";
  technical_weight: number | null;
  price_weight: number | null;
  estimated_price: number | null;
  rows: CommercialRow[];
}

// Mirrors backend/app/schemas/awards.py exactly.
export interface AllocationOut {
  bid_id: number;
  vendor_id: number;
  vendor_name: string;
  share_pct: number;
  quantity: number;
}

export interface AwardRound {
  round_number: number;
  status: string;
  kind: string;
  is_override: boolean;
  officer_reason: string | null;
  system_top_bid_id: number | null;
  system_top_vendor: string | null;
  proposed: AllocationOut[];
  final: AllocationOut[];
  required_tier: number | null;
  award_value: number | null;
  recommended_by: string | null;
  recommended_at: string | null;
  submitted_at: string | null;
  decision_kind: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_comments: string | null;
}

export interface AwardLine {
  line_item_id: number;
  product_code: string;
  product_name: string;
  procurement_type: ProcurementType;
  qty: number;
  uom: string | null;
  split_award_allowed: boolean;
  evaluation_method: string;
  technical_closed: boolean;
  state: "none" | "draft" | "pending" | "approved" | "excluded" | "returned";
  method: "L1" | "QCBS" | null;
  statement: CommercialRow[] | null;
  current: AwardRound | null;
  history: AwardRound[];
  can_recommend: boolean;
  can_decide: boolean;
  min_split_pct: number;
}

export interface PoFileBrief {
  id: number;
  batch_id: string;
  vendor_name: string;
  version: number;
  status: string;
}

export interface AwardTender {
  tender_id: number;
  title: string;
  status: TenderStatus;
  department: string | null;
  facility_name: string;
  lines: AwardLine[];
  required_tier: number | null;
  pending_value: number;
  can_submit: boolean;
  submit_blockers: string[];
  po_files: PoFileBrief[];
  awarded_at: string | null;
}

export interface AwardTenderSummary {
  tender_id: number;
  title: string;
  status: TenderStatus;
  lines_total: number;
  counts: Record<string, number>;
  required_tier: number | null;
  pending_value: number;
  waiting_for_you: boolean;
}

export interface RecommendationSave {
  mode: "confirm_top" | "other_vendor" | "split" | "exclude";
  bid_id?: number | null;
  allocations?: { bid_id: number; share_pct: number }[] | null;
  reason?: string | null;
}

export interface DecisionIn {
  decision: "approve" | "award_system_l1" | "reject";
  comments?: string | null;
  allocations?: { bid_id: number; share_pct: number }[] | null;
}

// Mirrors backend/app/schemas/vendor_portal.py's PortalLineItemOut/
// PortalTenderOut, bid.py's MyBidOut, and open_link.py's RegisteredTenderOut.
export type BidStatus = "draft" | "submitted" | "withdrawn" | "pending_late_exception";

export interface PortalLineItem {
  line_item_id: number;
  product_name: string;
  qty: number;
  already_bid: boolean;
  bid_status: BidStatus | null;
}

export interface PortalTender {
  tender_id: number;
  title: string;
  facility_name: string;
  tender_type: TenderType;
  status: TenderStatus;
  bid_due_date: string | null;
  can_bid: boolean;
  line_items: PortalLineItem[];
}

export interface MyBid {
  id: number;
  tender_line_item_id: number;
  tender_id: number;
  tender_title: string;
  product_name: string;
  qty: number;
  status: BidStatus;
  unit_price: number | null;
  total_price: number | null;
  submitted_at: string | null;
  outcome: string | null;
}

export interface RegisteredTender {
  title: string;
  facility_name: string | null;
  department: string | null;
  bid_due_date: string | null;
  state: "unpublished" | "open" | "closed";
  id: number;
  tender_status: string;
}

// Mirrors backend/app/schemas/bid.py exactly.
export type BidAttachmentKindBid = string; // BidAttachmentKind -- a vendor's own attachment slot, keyed by `kind` (not a free-form type like VendorDocType)

export interface BidAttachment {
  id: number;
  kind: BidAttachmentKindBid;
  description: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface Bid {
  id: number;
  status: BidStatus;
  unit_price: number | null;
  gst_percent: number | null;
  other_duties: number | null;
  delivery_lead_days: number | null;
  quote_validity_days: number | null;
  payment_terms: string | null;
  compliant_full: boolean;
  technical_compliance: string | null;
  brand_offered: string | null;
  details: Record<string, unknown>;
  comments: string | null;
  submitted_at: string | null;
  amended_at: string | null;
  withdrawn_at: string | null;
  attachments: BidAttachment[];
  total_price: number | null;
  landed_unit_price: number | null;
  landed_total: number | null;
}

export interface BidSlot {
  kind: BidAttachmentKindBid;
  label: string;
  mandatory: boolean;
}

export interface BidRequirements {
  required_fields: string[];
  compliance_required: boolean;
  slots: BidSlot[];
}

export interface CatalogSpec {
  unit_of_measure: string | null;
  regulatory_class: string | null;
  approved_brands: string[];
  type_specific_attrs: Record<string, unknown>;
}

export interface LineContext {
  line_item_id: number;
  tender_id: number;
  tender_title: string;
  tender_type: TenderType;
  product_name: string;
  procurement_type: ProcurementType;
  qty: number;
  uom: string | null;
  bid_due_date: string | null;
  technical_eval_method: TechnicalEvalMethod;
  technical_weight: number | null;
  price_weight: number | null;
  split_award_allowed: boolean;
  shelf_life_tracked: boolean;
  catalog_spec: CatalogSpec;
  line_details: Record<string, unknown>;
  attachments: LineAttachment[];
}

export interface BidForm {
  context: LineContext;
  requirements: BidRequirements;
  bid: Bid | null;
  locked: boolean;
  lock_reason: string | null;
}

export interface TenderBids {
  tender_id: number;
  tender_title: string;
  tender_type: TenderType;
  tender_description: string | null;
  facility_name: string;
  terms_document_filename: string | null;
  open_tender: boolean;
  is_rate_contract: boolean;
  contract_start_date: string | null;
  contract_end_date: string | null;
  rate_contract_document_filename: string | null;
  bid_due_date: string | null;
  lines: BidForm[];
}

export interface BidBulkSaveResult {
  line_item_id: number;
  ok: boolean;
  error: string | null;
  form: BidForm | null;
}

export interface BidSavePayload {
  unit_price: number | null;
  gst_percent: number | null;
  other_duties: number | null;
  delivery_lead_days: number | null;
  quote_validity_days: number | null;
  payment_terms: string | null;
  compliant_full: boolean;
  technical_compliance: string | null;
  brand_offered: string | null;
  details: Record<string, unknown>;
  comments: string | null;
  submit: boolean;
}

export interface RatingManualUpdatePayload {
  procurement_type: ProcurementType;
  on_time_pct?: number;
  quality_pct?: number;
  compliance_pct?: number;
  responsiveness?: number;
  comment?: string;
}

// ---- Dashboard (Phase 12) -- mirrors backend/app/schemas/dashboard.py and
// auth.py's CurrentUser exactly. ----
export type StaffRole = "procurement_officer" | "category_manager" | "approving_authority" | "system_admin";

export interface CurrentUser {
  id: number;
  email: string;
  full_name: string;
  role: StaffRole;
  approval_tier: number | null;
  facility_id: number | null;
}

export interface DashboardDraftTender {
  id: number;
  title: string;
  line_count: number;
  created_at: string;
}

export interface DashboardHeldLine {
  tender_id: number;
  tender_title: string;
  product_name: string;
}

export interface DashboardPendingVendor {
  id: number;
  legal_name: string;
  responded: boolean;
  expedited_review_tender_id: number | null;
}

export interface DashboardDocsToVerify {
  vendor_id: number;
  legal_name: string;
  count: number;
}

export interface DashboardPendingMapping {
  id: number;
  vendor_id: number;
  vendor_name: string;
  target_kind: string;
  target_name: string;
  requested_at: string;
}

export interface DashboardEvalWorkload {
  line_item_id: number;
  tender_id: number;
  tender_title: string;
  product_name: string;
  submitted_count: number;
  bid_due_date: string;
}

export interface DashboardStaleRating {
  vendor_id: number;
  vendor_name: string;
  procurement_type: ProcurementType;
  last_manual_update_at: string;
  days_since_update: number;
}

export interface DashboardAwardTask {
  tender_id: number;
  title: string;
  kind: "recommend" | "decide";
  lines: number;
  tier: number | null;
  detail: string;
}

export interface DashboardPendingApproval {
  id: number;
  title: string;
  round_number: number;
  required_tier: number;
}

// Any OverrideRequest currently resolved to the viewer's own role/tier --
// across every override type, not just late-submission exception/due-date
// extension. See backend/app/schemas/dashboard.py's DashboardPendingDecisionOut.
export interface DashboardPendingDecision {
  id: number;
  override_type: string;
  entity_label: string | null;
  reason_code: string;
  created_at: string;
}

export interface DashboardOfficerTender {
  id: number;
  title: string;
  status: TenderStatus;
  bids_received: number;
  bid_due_date: string | null;
  publish_date: string | null;
  lines_ready_to_recommend: number;
  lines_awaiting_decision: number;
  lines_total: number;
  progress_pct: number;
}

export interface DashboardOfficer {
  draft_count: number;
  pending_approval_count: number;
  live_count: number;
  awaiting_evaluation_close_count: number;
  ready_to_recommend_count: number;
  ready_to_recommend_lines: number;
  awaiting_decision_count: number;
  awaiting_decision_lines: number;
  tenders: DashboardOfficerTender[];
}

export interface DashboardApprovingAuthorityTender {
  id: number;
  title: string;
  status: TenderStatus;
  bids_received: number;
  bid_due_date: string | null;
  publish_date: string | null;
  needs_your_approval: boolean;
  required_tier: number | null;
  lines_ready_to_recommend: number;
  lines_awaiting_decision: number;
  lines_total: number;
  progress_pct: number;
}

export interface DashboardApprovingAuthority {
  pending_approval_count: number;
  live_count: number;
  ready_to_recommend_count: number;
  ready_to_recommend_lines: number;
  awaiting_decision_count: number;
  awaiting_decision_lines: number;
  tenders: DashboardApprovingAuthorityTender[];
}

export interface DashboardCategoryManager {
  live_count: number;
  awaiting_evaluation_count: number;
  evaluated_count: number;
}

export interface DashboardStats {
  open_tenders_count: number;
  pending_approval_count: number;
  vendors_pending_count: number;
  registered_vendors_count: number;
  bids_submitted_count: number;
  vendors_by_status: Record<string, number>;
  catalog_entries_count: number;
  mappings_approved_count: number;
  mappings_pending_count: number;
  lines_total: number;
  lines_published: number;
  last_rating_update: string | null;
  next_bid_close: string | null;
  held_lines: DashboardHeldLine[];
  draft_tenders: DashboardDraftTender[];
  pending_vendors: DashboardPendingVendor[];
  docs_to_verify: DashboardDocsToVerify[];
  pending_mappings: DashboardPendingMapping[];
  eval_workload: DashboardEvalWorkload[];
  stale_ratings: DashboardStaleRating[];
  award_tasks: DashboardAwardTask[];
  docs_expiring_count: number;
  docs_expired_count: number;
  pending_approval: DashboardPendingApproval[];
  pending_decisions: DashboardPendingDecision[];
  officer: DashboardOfficer | null;
  approving_authority: DashboardApprovingAuthority | null;
  category_manager: DashboardCategoryManager | null;
}
