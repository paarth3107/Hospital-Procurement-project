# Hospital E-Procurement — Implementation Specification (Phase 0)

Status: design/analysis only — **no application code has been written**. This is the
architecture/module/API plan called for in `CLAUDE.md`'s "Working process," produced
before any implementation begins.

Grounded in three sources:
- `E-Procurement-Spec-v2.md` — the authoritative business/functional spec (cited as §x.y below).
- `wireframe/index.html` (18 screens) — what the UI actually looks like and what state each screen needs.
- `E-Procurement Prototype.dc.html` — a second Claude-built prototype of the same spec; its `state{}` shape and per-screen data (`state.awards`, `state.mapping`, `state.overrides`, `state.split`, `state.bidUnit`, `state.poAck`, `state.vendorStatus`, etc.) is used below as evidence for what the frontend needs from the API, cited as "(prototype state)".
- `CLAUDE.md`'s **PROJECT OVERRIDE** — no vendor may bid anywhere (selective, manual-add, or Open Tender) without being an Active, approved vendor first. This is enforced in nearly every Module 1/3 function below and is called out explicitly wherever it changes a function's behavior from the base spec.

Module split, as requested — by **actor**, not by lifecycle stage (the spec's own Module 1–7 numbering is cited inline for traceability, but the organizing axis here is who acts):
1. **Vendor** — everything the vendor does to themselves and their own bids.
2. **Hospital** — everything hospital staff (5 internal roles) do.
3. **System** — engines and background processes no human directly drives.

---

## 0. Architecture & Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React (SPA) | Consumes the FastAPI JSON API. Role-aware routing/rendering per §11.1 permissions matrix. |
| API | FastAPI | Pydantic request/response models double as the API contract; one router module per Module below (`routers/vendor.py`, `routers/hospital.py`); Module 3 has no public router — it's internal services called by 1 and 2. |
| Backend language | Python | Service layer below FastAPI routers; routers stay thin (validate → call service → return), all business rules live in services, per `CLAUDE.md`'s "don't put business logic exclusively in controllers." |
| Database | PostgreSQL | Relational fit is strong — hierarchical tender→line-item→bid structure, foreign-keyed approvals, and the audit trail all want referential integrity and transactional guarantees (spec's own NFR: "transactional integrity for workflow transitions"). |
| Auth | Session or JWT (OPEN QUESTION — not specified) | RBAC middleware resolves the 6 roles (§11.1) + facility scope (§2.3) on every request; every write endpoint re-checks authorization server-side regardless of what the frontend renders (`CLAUDE.md`: "never rely on frontend button visibility alone"). |
| File storage | Adapter interface, mocked locally | Document/DMS Storage (§13.1) is an external integration boundary — implement `DocumentStore` interface (`upload`, `get`, `scan_for_malware`) with a local-disk mock now, swappable later. |
| Notifications | Adapter interface, mocked locally | Email/SMS Gateway (§13.1) — `NotificationSender` interface (`send_email`, `send_sms`), mock logs to console/DB now. |
| Background jobs | APScheduler (assumption — not spec'd) | For SLA/round-escalation checks, rating-refresh reminders, compliance-document-expiry flags, bid-deadline auto-lock. **OPEN QUESTION**: spec doesn't mandate a job runner; APScheduler assumed for a single-instance deployment, revisit if horizontal scaling is required. |
| GST/PAN verification, CAPTCHA, Digital Signature | Adapter interfaces, mocked locally | Per §13.1 — all optional/external, never faked as production integrations per `CLAUDE.md`. |

**Cross-cutting rule baked into every module below:** every workflow transition (approve, reject, override, publish, award) is validated and executed **server-side**; the API is the enforcement point, not the UI. This is the single most repeated rule across the spec (§1.2, §7.5, §9.6, §12.2, `CLAUDE.md`) and is not re-stated per function below — assume it everywhere.

---

## 1. Data Model (entities, not full DDL)

| Entity | Key fields | Notes |
|---|---|---|
| `facility` | id, name, legal_entity_code | §2.3 — every tender/mapping/PO scopes to exactly one. |
| `user_account` | id, role, facility_scope[] | Roles: Vendor, Procurement Officer, Procurement Admin, Category Manager/Technical Evaluator, Approving Authority, System Admin (§11.1). |
| `vendor` | id, status, gstin, pan, legal_name, ... | Status enum in §2 below. `status='Active'` is the single gate checked before any bid-related action, per PROJECT OVERRIDE. |
| `vendor_document` | id, vendor_id, doc_type, ref_no, valid_till, verification_state | KYC/statutory docs (§3.2); expiry-tracked (§3.5). |
| `product_master` | id, code, procurement_type (Item/Asset/Service), category, type_specific_attrs (JSONB) | §4.2; JSONB for the type-specific attribute set (§4.2.1/4.2.2) rather than one wide table. |
| `vendor_mapping` | id, vendor_id, product_master_id (or category_id for category-level), state, approved_by, approved_at, version | Many-to-many (§4.3); versioned, not overwritten. |
| `vendor_rating` | id, vendor_id, facility_id (nullable if group-wide), overall_score, price_competitiveness, on_time_pct, quality_pct, compliance_pct, responsiveness, is_stale, is_provisional | §5; weights are config, not hardcoded (25/25/20/15/15 are seed defaults per §5.2). |
| `rating_history` | id, vendor_rating_id, sub_score_name, old_value, new_value, entered_by, reason, entered_at | §5.3.1 point 3 — "prior values are retained in history rather than overwritten." |
| `tender` | id, facility_id, type (RFQ/RFP/RateContract/OpenTender), status, round_number, min_rating_threshold, min_invites, max_invites | §6.2; status enum below. |
| `tender_line_item` | id, tender_id, procurement_type, product_master_id, qty, split_award_allowed, min_rating_threshold_override, technical_eval_method (qualify_disqualify / scored / qcbs), technical_weight, price_weight | §6.3/6.3.4/9.4 — eval method + QCBS weights fixed here at creation, per §9.4's "cannot be changed after publish without a governed override." |
| `tender_attachment` | id, tender_id, line_item_id (nullable = header-level), file_ref, version, uploaded_by | §6.4. |
| `tender_invite` | id, tender_line_item_id, vendor_id, source (system_resolved / manual / registration_invite), reason_code, approved | §6.5–6.7 — every row here is, by PROJECT OVERRIDE, an Active vendor by the time it's `approved=true`. |
| `tender_approval_round` | id, tender_id, round_number, decision, reviewer_id, comments, decided_at | §7.3 — one row per round, never overwritten. |
| `bid` | id, tender_line_item_id, vendor_id, status (draft/submitted/locked), submitted_at | §8. |
| `bid_commercial` | id, bid_id, unit_price, tax, delivery_lead_time, payment_terms, quote_validity_days | Kept in a **separate table/column-set from technical fields** deliberately, to make the price-masking query boundary explicit (§9.6). |
| `bid_technical` | id, bid_id, compliance_statement, declared_shelf_life (nullable) | §8.2, §6.3.5. |
| `bid_attachment` | id, bid_id, file_ref, version | §8.3. |
| `technical_evaluation` | id, bid_id, evaluator_id, score (nullable for qualify/disqualify), qualified (bool), disqualify_reason | §9.2.3 — one row per evaluator when committee-based; consolidated separately. |
| `evaluation_result` | id, tender_line_item_id, bid_id, t_rank, l_rank, c_rank, consolidated_tech_score | Computed/cached result of the evaluation engine (Module 3). |
| `award_recommendation` | id, tender_line_item_id, recommended_bid_id, is_override, override_reason, split JSONB (`[{vendor_id, pct}]`), confirmed_by, confirmed_at | §9.5 — split proposal lives here (prototype state: `state.split`, `state.awards`). |
| `award_decision` | id, tender_line_item_id, approving_authority_id, decision, split JSONB (final), round_number | §10.2 — the Approving Authority's confirm/adjust of the proposed split lands here, distinct from the recommendation row above. |
| `po_data_file` | id, tender_id, vendor_id, batch_id, format (CSV/XML), status, generated_at, superseded_by | §10.3; one row per **vendor** per tender — a split line item produces one row per vendor sharing it. |
| `po_data_line` | id, po_data_file_id, tender_line_item_id, qty, unit_price, tax, line_total | §10.4 field set. |
| `override` | id, type, target_ref, initiator_id, reason_code, justification, state, approver_role, approver_id, decided_at, escalated_from | §12 — the one generic table backing every override type in §12.3. |
| `audit_log` | id, actor_id, role, action, entity_type, entity_id, before_state JSONB, after_state JSONB, reason, timestamp | §14 — immutable (DB-level: insert-only, no UPDATE/DELETE grants for the app role). |

---

## 2. State Machines

```
Vendor.status:      Draft → Pending Verification → Active
                                  ↓                    ↓
                            Info Requested        Suspended
                                  ↓                    ↑
                              Rejected / Blacklisted ──┘
  (§3.4 — Active is the sole gate for any bid-related action, PROJECT OVERRIDE)

Tender.status:       Draft → Pending E-Tender Approval → Published → Bid Window Closed
                              ↓ (reject)                              ↓
                            Draft (new round)              Pending L1 Approval
                                                                       ↓ (reject per line)
                                                            [per-line re-evaluation, new round]
                                                                       ↓ (all lines decided)
                                                            Awarded — Approved for Export
  (§7.3 — round_number increments per (re)submission; no cap by default, only escalation trigger)

Bid.status:          Draft → Submitted (locked at deadline)
  (§8.4 — no edits after submit; late submission requires an Override to unlock)

Override.state:      Requested → Pending Approval → Approved
                                       ↓                ↓
                                  Escalated          Rejected
                                       ↓
                                  Expired (SLA breach, auto-rejected)
  (§12.4 — generic to all 8 override types in §12.3)

PODataFile.status:    Pending Upload → Imported — PO Created in ERP
                                   ↓
                              Import Failed → (re-export override) → Pending Upload (new version)
  (§10.5)
```

---

## Module 1 — VENDOR

Router: `routers/vendor.py`, prefix `/api/vendor`, auth: vendor session, all writes scoped to `current_vendor.id`.

### 1.1 Registration

**Screens:** `VendorRegister.dc.html`, `OpenTenderLanding.dc.html` (identical form, per PROJECT OVERRIDE — no lightweight variant).

**Functions:**
- `POST /api/vendor/register` → `vendor_service.register(payload) -> Vendor` — creates `vendor` row, status=`Pending Verification`; runs GSTIN/PAN format + duplicate check (§3.5) before insert.
- `vendor_service.check_duplicate_gstin(gstin) -> Vendor | None` — used by both standard registration and Open Tender self-registration, so a returning vendor is matched instead of duplicated (§6.8.2 point 3).
- `POST /api/vendor/{id}/documents` → `vendor_service.upload_document(vendor_id, doc_type, file) -> VendorDocument` — routes through the `DocumentStore` adapter's malware scan (§6.4.2 pattern, reused).

**Flow:**
1. Vendor (or Open Tender visitor — same form) submits registration + KYC docs.
2. `register()` validates format, checks duplicate by GSTIN, inserts `vendor` + `vendor_document` rows.
3. Row enters Procurement Admin's queue (Module 2.2) as `Pending Verification`.
4. Vendor polls/receives notification on status change; **cannot bid on anything until `status='Active'`** (PROJECT OVERRIDE — this is the same code path whether they arrived via direct registration or an Open Tender link).

### 1.2 Profile & Category Requests

**Screens:** `VendorRegister.dc.html` (post-approval, viewed as profile — the prototype's `vProfile`/`regFields`/`regDocs`/`regCats` pattern is the reference for what a "view my profile" screen needs, since our own wireframe didn't build a separate read-only profile view).

**Functions:**
- `GET /api/vendor/{id}/profile` → company facts + document vault + category declarations.
- `POST /api/vendor/{id}/mapping-requests` → `mapping_service.request_mapping(vendor_id, product_master_id | category_id, credentials) -> VendorMapping` (state=`Pending`) — §4.3 point 1.

**Flow:** vendor requests a mapping (at registration or later) → lands in Category Manager's queue (Module 2.4) → vendor sees `Pending`/`Mapped` per category on their profile.

### 1.3 Browsing Eligible Tenders

**Screen:** `VendorDashboard.dc.html`.

**Functions:**
- `GET /api/vendor/{id}/tenders` → `tender_service.list_eligible_for_vendor(vendor_id)` — **critical function**: must call the same eligibility resolution used by Module 3.1, filtered to `vendor_id`, and must return **only the line items that vendor individually qualified for**, never the full tender (§6.5 — "a vendor will see only the line items for which it individually qualified, not the full tender").
- `GET /api/vendor/{id}/bid-history` → past bids + outcome status.

### 1.4 Bid Submission

**Screen:** `SubmitBid.dc.html`.

**Functions:**
- `POST /api/vendor/bids/draft` → `bid_service.save_draft(vendor_id, line_item_id, payload) -> Bid` — allowed pre-deadline, partial line-item bidding allowed unless tender mandates all-or-nothing (§8.4).
- `POST /api/vendor/bids/{id}/submit` → `bid_service.submit(bid_id)`:
  - Server-side gate #1 (PROJECT OVERRIDE): re-check `vendor.status == 'Active'` — **not just "invited"** — reject with 403 otherwise, regardless of what the frontend shows.
  - Server-side gate #2 (§6.5): re-check the vendor is still on the resolved/approved invite list for this exact line item.
  - Server-side gate #3 (§8.3): mandatory attachment checklist satisfied (per procurement type, §8.3.1) or reject.
  - Server-side gate #4 (§8.4): reject if `now() > tender_line_item.bid_due_date` — **late submission has no code path to succeed**; it can only be unlocked afterward via an Override (Module 3.4), never accepted directly.
  - Locks the bid: no further edits to `bid`, `bid_commercial`, `bid_technical`, or `bid_attachment` rows for this `bid_id`.
- `POST /api/vendor/bids/{id}/attachments` → same malware-scan path as registration docs.

### 1.5 Awards & POs

**Screen:** `VendorAwards.dc.html`.

**Functions:**
- `GET /api/vendor/{id}/awards` → per-line outcome (`Awarded` / `Not Selected` / `Under Review` / `Technically Disqualified`) — §10.6 distinguishes regret from technical-disqualification notices; the API must carry that distinction through, not collapse it to one status string.
- `GET /api/vendor/{id}/purchase-orders` → PO list + line items + approval trail.
- `POST /api/vendor/purchase-orders/{id}/acknowledge` → `po_service.vendor_acknowledge(po_id)`.
- `POST /api/vendor/purchase-orders/{id}/request-amendment` → creates an `override` row, type=`po_reexport` (§10.5 point 5 — "a previously-approved award cannot be silently altered").

---

## Module 2 — HOSPITAL

Router: `routers/hospital.py`, prefix `/api/hospital`, auth: staff session; every endpoint additionally checks `role in allowed_roles_for_this_action` per the §11.1 matrix, and for approval actions, resolves the acting role against §11.2's value-based matrix rather than trusting the caller's claimed role/tier.

### 2.1 Vendor Approval

**Screen:** `VendorApproval.dc.html`. Role: Procurement Admin.

**Functions:**
- `GET /api/hospital/vendors/pending` → queue.
- `POST /api/hospital/vendors/{id}/approve` → `vendor_service.approve(vendor_id, admin_id)` — sets `status='Active'`, **triggers Module 3.1's auto-open of category mapping** (§3.3 point 6).
- `POST /api/hospital/vendors/{id}/reject` → requires `reason` (mandatory, §3.3 point 5).
- `POST /api/hospital/vendors/{id}/request-info` → `status='Info Requested'`.

### 2.2 Product Master

**Screen:** `ProductMaster.dc.html`. Role: Procurement Admin.

**Functions:** standard CRUD (`GET/POST/PUT` `/api/hospital/products`), with `procurement_type` driving which `type_specific_attrs` schema is validated (Pydantic discriminated union on `procurement_type`, matching §4.2.1/4.2.2).

### 2.3 Vendor Mapping

**Screens:** `VendorMappingMatrix.dc.html` (overview), `VendorMapping.dc.html` (approve one request). Role: Category Manager.

**Functions:**
- `GET /api/hospital/mappings/matrix?facility_id=` → vendor × category grid.
- `GET /api/hospital/mappings/{vendor_id}/{product_id}` → detail + history (matches prototype's `mapDetail.history`/`mapDetail.skus` shape).
- `POST /api/hospital/mappings/{id}/approve` / `/reject` — §4.3 point 2: "category approval does not auto-approve every SKU/service line within it, unless configured for bulk approval" — the approve function takes an explicit scope (category-only vs specific SKUs).
- `POST /api/hospital/mappings/{id}/suspend` → logged with reason (§4.4).

### 2.4 Vendor Rating

**Screen:** `VendorRating.dc.html`. Role: Procurement Admin.

**Functions:**
- `GET /api/hospital/vendors/{id}/rating` → composite + sub-scores + history.
- `POST /api/hospital/vendors/{id}/rating/manual-entry` → `rating_service.enter_manual_scores(vendor_id, scores, comment_if_material_change)` — **not** an override (§5.3.1 point 3: "standard data entry... not a governed override"), but every entry is still logged to `rating_history`.
- `POST /api/hospital/vendors/{id}/rating/override-price-competitiveness` → **is** a governed override (§5.3.1 point 4) — routes through Module 3.4, does not write to `vendor_rating` directly until Approved.

### 2.5 Tender Creation

**Screen:** `CreateTender.dc.html`. Role: Procurement Officer.

**Functions:**
- `POST /api/hospital/tenders` → creates `tender` (status=`Draft`).
- `POST /api/hospital/tenders/{id}/line-items` → validated per `procurement_type` discriminant (§6.3.1/6.3.2/6.3.3), including `split_award_allowed` and `technical_eval_method` (§6.3.4, §9.4 — fixed here, immutable post-publish without an override).
- `POST /api/hospital/tenders/{id}/line-items/{lid}/attachments` → blocked from completing if the per-type mandatory checklist (§6.4.1) isn't satisfied.
- `GET /api/hospital/tenders/{id}/eligibility-preview` → calls Module 3.1 directly, per line item, so the Officer sees the resolved list before submitting.
- `POST /api/hospital/tenders/{id}/manual-vendor` → adds an **existing Active** vendor only (per our `CreateTender.dc.html` copy) — creates an `override` (type=`vendor_add`), does not touch `tender_invite` until Approved.
- `POST /api/hospital/tenders/{id}/invite-registration` → **(PROJECT OVERRIDE'S core function)** sends a registration invite email to a not-yet-registered prospect; does **not** create a `tender_invite` row at all yet — only once that person registers and is separately Approved (Module 2.1) does an officer then run `manual-vendor` against their now-Active profile. There is no function anywhere in this module that adds an unapproved vendor to a `tender_invite`.
- `POST /api/hospital/tenders/{id}/submit-for-approval` → validates §6.9's two submission blocks (mandatory attachments; zero-eligible-vendor lines without a covering override or Open Tender exemption), then creates the next `tender_approval_round` row and sets status=`Pending E-Tender Approval`.

### 2.6 E-Tender Approval

**Screen:** `TenderApproval.dc.html`. Role: Approving Authority (resolved by §11.2).

**Functions:**
- `GET /api/hospital/approvals/tenders/pending` → queue, resolved to the caller's authority tier.
- `POST /api/hospital/tenders/{id}/approve` → **hard gate**: refuses if any linked `override` for this tender is still `Pending`/`Escalated` (§7.2 point 2). On success: `status='Published'`; for Open Tender, activates the public link instead of compiling an invite list (§6.8.1); triggers Module 3.5 notifications.
- `POST /api/hospital/tenders/{id}/reject` → requires comments (mandatory), writes the `tender_approval_round` row, resets to `Draft`.
- Round/escalation logic lives in Module 3.10, called from both approve/reject paths.

### 2.7 Bid Evaluation & L1 Selection

**Screen:** `TenderDetail.dc.html`. Roles: Category Manager/Technical Evaluator (scoring), Procurement Officer (recommendation).

**Functions:**
- `POST /api/hospital/evaluations/{bid_id}/technical` → `evaluation_service.score_or_qualify(bid_id, evaluator_id, score|qualify_bool)` — branches on `tender_line_item.technical_eval_method`; **strictly gated on `now() > bid_due_date`** (§9.2.3 point 1 — technical data can't unlock early).
- `GET /api/hospital/tenders/{id}/line-items/{lid}/comparative-statement` → calls Module 3.3 to return consolidated T-rank/L-rank/C-rank.
- `POST /api/hospital/tenders/{id}/line-items/{lid}/recommend` → `award_service.propose_recommendation(line_item_id, bid_id, split JSONB | null)` — writes `award_recommendation`; if `bid_id` isn't the top rank, requires `override_reason` and routes through Module 3.4 before the recommendation is forwardable (§9.5 point 3).
- `POST /api/hospital/tenders/{id}/submit-for-l1-approval` → only once every line item has a confirmed recommendation (§9.5 point 5).

### 2.8 L1 Approval

**Screen:** `RejectFlow.dc.html`. Role: Approving Authority.

**Functions:**
- `POST /api/hospital/l1-approvals/{line_item_id}/approve` → `award_service.decide(line_item_id, decision='approve', split_adjustment JSONB | null)` — writes `award_decision`; if `split_adjustment` differs from the proposed split, that's the Approving Authority's final say (§10.2 point 3) — **not** a new override, just an adjustment within this same approval action.
- `POST /api/hospital/l1-approvals/{line_item_id}/reject` → mandatory comments; routes the line item back to Module 2.7 for re-evaluation, with its own round history (§10.2 point 5).
- `POST /api/hospital/l1-approvals/{line_item_id}/override-award` → non-L1/C1 award; requires reason code + justification, routes through Module 3.4.
- Once **every** line item in a tender is decided: `award_service.finalize_tender(tender_id)` sets `status='Awarded — Approved for Export'` and triggers Module 3.6.

### 2.9 PO Export Management

**Screen:** `POExport.dc.html`. Role: Procurement Admin.

**Functions:**
- `GET /api/hospital/po-exports` → list + status.
- `POST /api/hospital/po-exports/{id}/download` / `push-to-erp` — depends on the integration pattern (OPEN QUESTION §17.7).
- `POST /api/hospital/po-exports/{id}/confirm-import` (manual reconciliation path) / webhook receiver for automated confirmation.
- `POST /api/hospital/po-exports/{id}/reexport` → governed override (§10.5 point 5), routes through Module 3.4; new file **supersedes, does not delete** the prior version (§10.7).

### 2.10 Override Approval Queue

**Screen:** `OverrideQueue.dc.html`. Role: whoever the type+value resolves to (§12.3/12.5).

**Functions:**
- `GET /api/hospital/overrides?state=Pending` → queue, resolved to caller's role/authority.
- `POST /api/hospital/overrides/{id}/approve` → `override_service.approve(id, approver_id)` — **the only place any override's target record is actually mutated** (§12.2's governing rule — this function is the single choke point every other module's override-creating calls eventually resolve through).
- `POST /api/hospital/overrides/{id}/reject` → mandatory rejection reason; target record untouched.

### 2.11 Audit Log

**Screen:** `AuditLog.dc.html`. Role: System Admin (and other roles per access scope, §12.6/§14).

**Functions:** `GET /api/hospital/audit-log?filters=` — read-only, paginated, filterable by actor/module/date/action-type; backed by Module 3.7.

---

## Module 3 — SYSTEM

No public router of its own — these are services other modules call into. Listed here because they're where most of the spec's actual "intelligence" lives.

### 3.1 Eligibility Resolution Engine

`eligibility_service.resolve(tender_line_item_id) -> list[Vendor]`

**Flow (§6.5's filter chain, in this exact order):**
1. `vendor.status == 'Active'`.
2. Active `vendor_mapping` exists for the line's exact product or parent category.
3. `vendor_rating.overall_score >= line_item.min_rating_threshold_override or tender.min_rating_threshold`.
4. Not `Suspended`/`Blacklisted`, no expired mandatory `vendor_document`.
5. If `max_invites` set and more qualify: rank by rating desc, take top N.

Called by: Module 2.5's preview, Module 2.6's approval-time re-check, Module 1.3's per-vendor filtered list. If a line resolves to zero vendors: blocks tender submission (Module 2.5) unless a manual-vendor override covers it, or the line is on an Open Tender (exempt, §6.9 point 3).

### 3.2 Rating Computation Engine

`rating_service.recompute_price_competitiveness(vendor_id) -> float` — the **only** auto-computed sub-score (§5.3), from this system's own historical bid/L1 data, rolling 12-month window (config). Triggered after every tender's L1 Approval finalizes (new bid-history data point) and on a scheduled cadence (Module 3.8).

`rating_service.recompute_composite(vendor_id)` — weighted sum of 5 sub-scores (config-driven weights, seeded 25/25/20/15/15 per §5.2), runs whenever *either* the auto sub-score or a manual sub-score changes.

### 3.3 Evaluation Engine

`evaluation_service.consolidate_technical(line_item_id)` — averages/excludes-outlier across multiple `technical_evaluation` rows per configured method (§9.2.3 point 3); assigns T-rank; applies the minimum-qualifying-score cutoff (§9.2.3 point 5) and tie-break rule (§9.2.3 point 6).

`evaluation_service.rank_commercial(line_item_id)` — L-rank among technically-qualified bids only, by landed price; tie-break by rating → T-rank → timestamp (§9.3).

`evaluation_service.rank_combined(line_item_id)` — QCBS C-rank where configured: `combined = tech_score_pct * technical_weight + price_score_pct * price_weight`, price normalized so the lowest qualified bid scores 100% (§9.4).

**Flagging the gap surfaced earlier in this conversation:** for a *technically-sensitive Item* line using Scored Technical Ranking, §9.2.2's criteria table only assigns weight to 3 of 7 criteria for Item lines (Compliance 35% + Rating 15% + Past performance 15% = 65%) — the remaining 35% has no defined destination for Items. `evaluation_service` needs an explicit policy here before this can be implemented (**OPEN QUESTION**, not resolved by the spec).

### 3.4 Override & Exception Workflow Engine

`override_service.request(type, target_ref, initiator_id, reason_code, justification) -> Override` — the single entry point every override-creating call in Modules 1/2 goes through; resolves `approver_role` from `type` + value/count band (§12.3/12.5), inserts `state='Requested'` → immediately `'Pending Approval'`. Target record is **never** touched here.

`override_service.approve(id, approver_id)` — the only function that mutates the target record, per type (a dispatch table: `rating_override_apply`, `vendor_add_apply`, `technical_score_correction_apply`, etc.) — each "apply" function is otherwise identical in shape to the direct-write functions in Module 2, just gated behind this call.

`override_service.check_escalations()` (Module 3.8 job) — scans `Pending` overrides for value/count/SLA breach, re-routes to next role, or auto-rejects as `Expired` past the SLA window (§12.4 points 5–6).

### 3.5 Notification Engine

`notification_service.send(event_type, recipient, context)` — one dispatch table covering every status transition in §13.2's integration touch-point table (registration status, tender invite/publish, award/regret/technical-disqualification, due-date extension, escalation reminders). Fires through the `NotificationSender` adapter (Module 0).

### 3.6 PO Data File Generation

`po_service.generate(tender_id) -> list[PODataFile]` — one file per awarded vendor (§10.3); for a split line item, each vendor's file carries only their allocated share (this is the inference flagged earlier as *not* verbatim spec text, but structurally required given "one file per vendor"). Fields per §10.4's table exactly. Every value traces back to an `award_decision` row — **no field is computed independently of that row** (§10.7).

`po_service.reexport(po_data_file_id) -> PODataFile` — only reachable via an approved override (Module 3.4); old file marked `superseded_by`, never deleted (§10.7).

### 3.7 Audit Logging Service

`audit_service.record(actor_id, role, action, entity_type, entity_id, before, after, reason=None)` — called from **inside** every service function above that changes state (not bolted on at the router level, so nothing can skip it). Table is insert-only at the DB grant level (§14 "immutable").

### 3.8 Scheduled Jobs

- `job.check_document_expiry()` — flags/auto-suspends vendors with expired mandatory compliance docs (§3.5).
- `job.check_rating_staleness()` — flags `Stale — Manual Update Due` past the configured overdue window (§5.3.1 point 5).
- `job.check_round_and_override_escalations()` — SLA breach → escalate/expire, for both `tender_approval_round` and `override` (§7.3 points 5–6, §12.4 points 5–6).
- `job.lock_expired_bid_windows()` — enforces §9.6's simultaneous unlock timing; this is the actual mechanism behind price-masking, not just a query-time filter (see 3.9).

### 3.9 Price Confidentiality Enforcement

Not a job — a **query-layer rule**: any endpoint or service function that would return `bid_commercial` fields must check `now() > tender_line_item.bid_due_date` **and** (where two-envelope separation is configured) that `technical_evaluation` has been recorded for that bid, before including those fields at all — never mask at the serialization/frontend layer (§9.6, `CLAUDE.md`'s "never expose sensitive bid information through APIs before the appropriate workflow stage"). This applies equally to Procurement Officer, Category Manager, and Approving Authority — no role is exempt pre-deadline.

### 3.10 Round & Escalation Tracking

`round_service.record_submission(tender_id) -> int` (next round number), `round_service.record_decision(round_id, decision, comments)` — shared by both E-Tender Approval (Module 2.6) and L1 Approval (Module 2.8), per §7.3 point 9's explicit statement that round-tracking is identical across both gates.

---

## Open Questions Carried Into Implementation

Everything in `CLAUDE.md`'s "Known open questions" still applies unchanged. Additionally, from this pass:

10. **Item-line QCBS weight gap** (Module 3.3) — §9.2.2's criteria table doesn't sum to 100% for a technically-sensitive Item line. Needs a policy decision before `evaluation_service` can implement scored Item evaluation.
11. **Job runner choice** (Module 0) — APScheduler assumed for Module 3.8; not spec'd, revisit if multi-instance deployment is planned.
12. **Auth mechanism** (Module 0) — session vs JWT not specified; either satisfies the spec's RBAC requirement, but affects React's token-refresh handling and needs a decision before frontend work starts.
