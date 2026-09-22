# Hospital E-Procurement — Technical Implementation Specification

Status: design/analysis only — **no application code has been written yet**. This
supersedes the previous version of this file (which organized around Vendor/
Hospital/System actor modules); this pass uses a conventional layered/resource
structure instead.

Grounded in:
- `E-Procurement-Spec-v2.md` — the authoritative business/functional spec (cited as §x.y).
- `wireframe/` (19 screens, `index.html`) — what the UI is and what data each screen needs.
- `E-Procurement Prototype.dc.html` — a second Claude-built prototype of the same spec; its `state{}` shape is used below as evidence for frontend data needs, cited as "(prototype state)".
- `CLAUDE.md`'s **PROJECT OVERRIDE** — no vendor may bid anywhere without being an Active, approved vendor first, including Open Tender and manual/guest-sourced invites. This is enforced server-side in every endpoint below that touches eligibility or bid submission.

**Tech stack:** Python (backend), JavaScript (frontend — framework not fixed by this document; see §6), PostgreSQL (database), FastAPI (the API layer connecting the two).

---

## 1. Overview

A seven-stage procurement pipeline (spec §2): vendor onboarding → catalog/mapping →
rating → tender creation → tender approval → bidding → evaluation → award approval →
PO export. Two explicit, separate approval gates (E-Tender Approval, L1 Approval) are
the spec's central design constraint — nothing in this system auto-publishes a tender
or auto-confirms an award. A second constant is server-side enforcement: eligibility,
price confidentiality, and approval state are never trusted from the client.

---

## 2. Architecture & Tech Stack

```
 ┌─────────────┐      HTTPS/JSON      ┌──────────────┐      SQL       ┌────────────┐
 │  JS Frontend │ ───────────────────▶ │   FastAPI    │ ─────────────▶ │ PostgreSQL │
 │   (SPA)      │ ◀─────────────────── │  (Python)    │ ◀───────────── │            │
 └─────────────┘                      └──────┬───────┘                └────────────┘
                                              │
                              ┌───────────────┼────────────────┐
                              ▼               ▼                ▼
                        DocumentStore   NotificationSender   Scheduler
                        (DMS adapter)   (Email/SMS adapter)  (jobs, §7)
```

| Layer | Choice | Notes |
|---|---|---|
| Frontend | JavaScript SPA | `wireframe/index.html` already demonstrates the page inventory and per-page state needs in plain JS — whether to introduce a framework (React, Vue, or stay vanilla) is an open question (§12), not fixed here. |
| API | FastAPI | Pydantic models are the request/response contract. Routers organized by **resource** (§5), not by caller role — role/permission checks happen inside each endpoint via dependency injection, not by routing to different paths per role. |
| Backend logic | Python | Service layer beneath the routers; routers stay thin (validate → call service → serialize response). No business logic in routers or in the ORM models themselves. |
| Database | PostgreSQL | Strong relational fit — tender → line item → bid → evaluation → award → PO is a deep FK chain, and the audit/approval tables need transactional guarantees. |
| Auth | Session or JWT (**open question**, §12) | RBAC resolved per-request against the 6 roles in spec §11.1, scoped additionally by facility (§2.3). |
| File storage | `DocumentStore` adapter, mocked locally | External DMS integration boundary (§13.1); local disk + malware-scan stub for now. |
| Notifications | `NotificationSender` adapter, mocked locally | Email/SMS gateway boundary (§13.1); logs to a table for now instead of actually sending. |
| Background jobs | APScheduler (**assumption**, not spec'd) | SLA/escalation checks, rating-staleness flags, document-expiry flags, bid-deadline locking (§7). |

**Cross-cutting rule, assumed everywhere below and not repeated per-endpoint:** every
state-changing endpoint re-validates authorization and business rules server-side,
regardless of what the frontend would have allowed the user to click.

---

## 3. Data Model

| Table | Key columns | Notes |
|---|---|---|
| `facility` | id, name, legal_entity_code | §2.3 — every tender/mapping/PO scopes to exactly one. |
| `user_account` | id, role, facility_scope[] | Roles per §11.1. |
| `vendor` | id, status, gstin, pan, legal_name | `status='Active'` is the single, non-negotiable gate for any bid-related action (PROJECT OVERRIDE). |
| `vendor_document` | id, vendor_id, doc_type, ref_no, valid_till, verification_state | §3.2; expiry-tracked (§3.5). |
| `product_master` | id, code, procurement_type, category, type_specific_attrs (JSONB) | §4.2; JSONB holds the Item/Asset/Service-specific attribute set (§4.2.1/4.2.2). |
| `vendor_mapping` | id, vendor_id, product_master_id, state, approved_by, version | §4.3 — many-to-many, versioned, never overwritten. |
| `vendor_rating` | id, vendor_id, facility_id (nullable), overall_score, price_competitiveness, on_time_pct, quality_pct, compliance_pct, responsiveness, is_stale, is_provisional | §5; seed weights 25/25/20/15/15 (§5.2), config not hardcoded. |
| `rating_history` | id, vendor_rating_id, field, old_value, new_value, entered_by, reason | §5.3.1 — prior values retained, not overwritten. |
| `tender` | id, facility_id, type, status, round_number, min_rating_threshold, min_invites, max_invites | §6.2. |
| `tender_line_item` | id, tender_id, procurement_type, product_master_id, qty, split_award_allowed, min_rating_threshold_override, technical_eval_method, technical_weight, price_weight | §6.3/6.3.4/9.4 — eval method + QCBS weights fixed here at creation. |
| `tender_attachment` | id, tender_id, line_item_id (nullable = header), file_ref, version | §6.4. |
| `tender_invite` | id, tender_line_item_id, vendor_id, source, reason_code, approved | §6.5–6.7 — every `approved=true` row is, by construction, an Active vendor. |
| `tender_approval_round` | id, tender_id, round_number, decision, reviewer_id, comments, decided_at | §7.3. |
| `bid` | id, tender_line_item_id, vendor_id, status | §8. |
| `bid_commercial` | id, bid_id, unit_price, tax, delivery_lead_time, payment_terms, quote_validity_days | Deliberately separated from technical fields to make the price-masking boundary explicit (§9.6). |
| `bid_technical` | id, bid_id, compliance_statement, declared_shelf_life | §8.2, §6.3.5. |
| `bid_attachment` | id, bid_id, file_ref, version | §8.3. |
| `technical_evaluation` | id, bid_id, evaluator_id, score, qualified, disqualify_reason | §9.2.3 — one row per evaluator when committee-based. |
| `evaluation_result` | id, tender_line_item_id, bid_id, t_rank, l_rank, c_rank, consolidated_tech_score | Cached output of the ranking engine (§5.3 of this document). |
| `award_recommendation` | id, tender_line_item_id, recommended_bid_id, is_override, override_reason, split (JSONB), confirmed_by | §9.5 — split proposal (prototype state: `state.split`, `state.awards`). |
| `award_decision` | id, tender_line_item_id, approving_authority_id, decision, split (JSONB, final), round_number | §10.2 — the Approving Authority's confirm/adjust of the split lands here. |
| `po_data_file` | id, tender_id, vendor_id, batch_id, format, status, generated_at, superseded_by | §10.3 — one row per **vendor** per tender; a split line item produces one row per vendor sharing it. |
| `po_data_line` | id, po_data_file_id, tender_line_item_id, qty, unit_price, tax, line_total | §10.4 field set. |
| `override` | id, type, target_ref, initiator_id, reason_code, justification, state, approver_role, approver_id, decided_at, escalated_from | §12 — one generic table backing every override type in §12.3. |
| `audit_log` | id, actor_id, role, action, entity_type, entity_id, before_state (JSONB), after_state (JSONB), reason, timestamp | §14 — insert-only at the DB grant level. |

---

## 4. State Machines

```
vendor.status:        Draft -> Pending Verification -> Active
                                     |                    |
                               Info Requested         Suspended
                                     |                    ^
                                 Rejected/Blacklisted -----'
  (§3.4 -- Active is the sole gate for any bid-related action, PROJECT OVERRIDE)

tender.status:         Draft -> Pending E-Tender Approval -> Published -> Bid Window Closed
                                  ^ (reject)                                |
                                  '------------------ new round             v
                                                                  Pending L1 Approval
                                                                            | (reject per line)
                                                          [re-evaluate that line, new round]
                                                                            | (all lines decided)
                                                              Awarded -- Approved for Export
  (§7.3 -- round_number increments per (re)submission; no cap by default, escalation only)

bid.status:             Draft -> Submitted (locked at deadline)
  (§8.4 -- no post-submit edits; late submission needs an Override to unlock, never a direct path)

override.state:         Requested -> Pending Approval -> Approved
                                            |                |
                                       Escalated          Rejected
                                            |
                                        Expired (SLA breach, auto-rejected)
  (§12.4 -- generic to all 8 override types in §12.3)

po_data_file.status:    Pending Upload -> Imported -- PO Created in ERP
                                    |
                               Import Failed -> (re-export override) -> Pending Upload (new version)
  (§10.5)
```

---

## 5. API Design

FastAPI routers organized by **resource**, mounted under `/api/v1/`. Every endpoint's
role/facility check is a dependency, not a separate route — e.g. `GET /tenders/{id}`
returns different levels of detail to a Vendor vs. a Procurement Officer, rather than
living at two different paths.

### 5.1 Auth
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`

### 5.2 Vendors
- `POST /vendors` — register (also used by the Open Tender registration form, §6.8 — same code path per PROJECT OVERRIDE, no lightweight variant).
- `GET /vendors/{id}`, `GET /vendors?status=Pending Verification` (staff queue).
- `POST /vendors/{id}/documents` — through the `DocumentStore` malware-scan path.
- `POST /vendors/{id}/approve` / `/reject` / `/request-info` — Procurement Admin; `approve` triggers auto-open of category mapping (§3.3 point 6).
- `POST /vendors/{id}/rating/manual-entry` — **not** an override (§5.3.1 point 3), still logged to `rating_history`.
- `POST /vendors/{id}/rating/override-price-competitiveness` — **is** an override (§5.3.1 point 4), routes through §5.10.
- `GET /vendors/{id}/rating`

### 5.3 Product Master
- `GET/POST/PUT /products` — `procurement_type` drives a discriminated Pydantic schema (§4.2.1/4.2.2).

### 5.4 Vendor Mapping
- `POST /mappings` — vendor requests (§4.3 point 1).
- `GET /mappings/matrix?facility_id=`
- `GET /mappings/{vendor_id}/{product_id}` — detail + history.
- `POST /mappings/{id}/approve` / `/reject` / `/suspend` — Category Manager; approve takes an explicit scope (category-only vs. specific SKUs, §4.3 point 2).

### 5.5 Tenders
- `POST /tenders` (Draft) → `POST /tenders/{id}/line-items` → `POST /tenders/{id}/line-items/{lid}/attachments`.
- `GET /tenders` — the list backing the wireframe's `TenderList` screen; filterable by status/facility.
- `GET /tenders/{id}/eligibility-preview` — calls §5.9's resolver per line item.
- `POST /tenders/{id}/manual-vendor` — **existing Active vendors only**; creates an override (type=`vendor_add`).
- `POST /tenders/{id}/invite-registration` — sends a registration invite; **creates no `tender_invite` row** — that only happens later, once the invitee is separately Approved and then explicitly added (PROJECT OVERRIDE — there is no function anywhere that adds an unapproved vendor to `tender_invite`).
- `POST /tenders/{id}/submit-for-approval` — validates §6.9's two blocks (mandatory attachments; zero-eligible lines without a covering override or Open Tender exemption).
- `POST /tenders/{id}/approve` — hard-gated on no `Pending`/`Escalated` overrides for this tender (§7.2 point 2); on success, `Published`, and for Open Tender activates the public link instead of an invite list (§6.8.1).
- `POST /tenders/{id}/reject` — mandatory comments; writes `tender_approval_round`, resets to `Draft`.

### 5.6 Bids
- `POST /bids/draft`, `POST /bids/{id}/submit` — the submit endpoint is the most heavily gated function in the system:
  1. `vendor.status == 'Active'` (PROJECT OVERRIDE, checked here regardless of frontend state).
  2. Vendor still on the approved invite list for this exact line item (§6.5).
  3. Mandatory attachments present (§8.3.1, by procurement type).
  4. `now() <= bid_due_date` — a late bid has no success path; it can only be unlocked afterward via an override (§5.10), never accepted directly.
- `POST /bids/{id}/attachments`
- `GET /tenders/{id}/line-items/{lid}/comparative-statement` — calls §5.3's ranking engine.

### 5.7 Evaluation & Awards
- `POST /evaluations/{bid_id}/technical` — branches on `technical_eval_method`; gated on `now() > bid_due_date` (§9.2.3 point 1).
- `POST /tenders/{id}/line-items/{lid}/recommend` — writes `award_recommendation`; non-top-rank requires `override_reason`, routes through §5.10 (§9.5 point 3).
- `POST /l1-approvals/{lid}/approve` — writes `award_decision`; a `split_adjustment` differing from the proposal is the Approving Authority's final say (§10.2 point 3), not a separate override.
- `POST /l1-approvals/{lid}/reject` — mandatory comments, sends the line back to re-evaluation with its own round history (§10.2 point 5).
- `POST /l1-approvals/{lid}/override-award` — non-L1/C1 award, routes through §5.10.

### 5.8 PO Export
- `GET /po-exports`, `POST /po-exports/{id}/download` or `/push-to-erp` (integration pattern is §12 open question), `POST /po-exports/{id}/confirm-import`, `POST /po-exports/{id}/reexport` (override, §5.10; supersedes, never deletes the prior file, §10.7).

### 5.9 Eligibility Resolver (internal service, no direct route)
`resolve(tender_line_item_id) -> list[vendor_id]` — the exact filter chain from §6.5:
Active status → active mapping → rating ≥ threshold → not suspended/no expired docs →
if `max_invites` set, rank by rating desc and cap. Called from §5.5's preview endpoint,
from the approval-time re-check, and from the vendor-facing tender list (only returning
the line items a given vendor individually qualifies for — §6.5's explicit requirement
that a vendor never sees the whole tender, only their own eligible lines).

### 5.10 Overrides
- `POST /overrides` — the single entry point every override-creating call above goes through; resolves `approver_role` from type + value/count band (§12.3/§12.5); never touches the target record.
- `GET /overrides?state=Pending`
- `POST /overrides/{id}/approve` — the **only** place any override's target record is mutated (§12.2); dispatches per type to the matching apply-function.
- `POST /overrides/{id}/reject`

### 5.11 Audit Log
- `GET /audit-log?filters=` — read-only, paginated.

---

## 6. Frontend Structure

The 19 `wireframe/*.dc.html` screens are the page inventory; `wireframe/index.html`
is already a working (if inert) implementation of the navigation shell in plain JS —
a real build can either keep that pattern (a shell + page-swap) or introduce a
framework. That choice is explicitly **not fixed by this document** (open question,
§12) since the user's own tech-stack note names only "JS," not a specific framework.

| Page (source screen) | Route (suggested) | Primary API calls |
|---|---|---|
| Dashboard | `/` | `GET /tenders`, `GET /overrides?state=Pending` |
| Tenders (list) | `/tenders` | `GET /tenders` |
| Create Tender | `/tenders/new` | `POST /tenders`, `.../line-items`, `.../eligibility-preview` |
| E-Tender Approval | `/approvals/tenders/:id` | `GET /tenders/:id`, `POST /tenders/:id/approve\|reject` |
| Evaluation & L1 Recommendation | `/tenders/:id/evaluate` | `GET .../comparative-statement`, `POST .../recommend` |
| L1 Approval | `/approvals/l1/:lid` | `POST /l1-approvals/:lid/approve\|reject` |
| Vendor Approval | `/vendors/pending` | `GET /vendors?status=`, `POST /vendors/:id/approve` |
| Item/Asset/Service Master | `/products` | `GET/POST /products` |
| Vendor Mapping Matrix | `/mappings` | `GET /mappings/matrix` |
| Vendor Mapping (approve) | `/mappings/:vid/:pid` | `GET/POST /mappings/:id/approve` |
| Vendor Rating | `/vendors/:id/rating` | `GET /vendors/:id/rating`, `POST .../manual-entry` |
| Vendor Registration | `/register` | `POST /vendors` |
| Vendor Dashboard | `/my/tenders` | `GET /vendors/:id/tenders` (eligibility-filtered, §5.9) |
| Submit Sealed Bid | `/my/tenders/:lid/bid` | `POST /bids/draft\|submit` |
| Awards & POs | `/my/awards` | `GET /vendors/:id/awards`, `.../purchase-orders` |
| PO Export | `/po-exports` | `GET /po-exports`, `POST .../download\|reexport` |
| Audit Log | `/audit-log` | `GET /audit-log` |
| Open Tender (public) | `/open/:tender_slug` | `POST /vendors` (same as registration, PROJECT OVERRIDE) |
| Override Queue | `/overrides` | `GET /overrides`, `POST .../approve\|reject` |

**Shared components** implied by the wireframe's own repeated patterns: status pill
(color-coded by state), a data table with header row + row template, a nav shell
(sidebar or header tabs, per `index.html`'s existing pattern), a reason-code chip
picker + justification textarea (used identically on every override-triggering
action, per §5.10), and a round/tier badge (used on both approval-gate screens).

---

## 7. Background Jobs & Automation

- `check_document_expiry()` — flags/auto-suspends vendors with expired compliance docs (§3.5).
- `check_rating_staleness()` — flags `Stale — Manual Update Due` past the overdue window (§5.3.1 point 5).
- `check_round_and_override_escalations()` — SLA breach → escalate/expire, for both `tender_approval_round` and `override` (§7.3, §12.4).
- `lock_expired_bid_windows()` — the actual mechanism behind price-masking timing (§9.6), not just a query-time filter.
- `recompute_price_competitiveness(vendor_id)` — after every tender's L1 Approval finalizes, and on a scheduled cadence (§5.2 of the spec).

---

## 8. Security & Access Control

- RBAC per spec §11.1's 6 roles, resolved server-side on every request via a FastAPI dependency, never inferred from the frontend route.
- Facility scoping (§2.3) is a second dimension on top of role — a Department Head at Facility A cannot approve a Facility B tender even with the right role.
- **Price confidentiality is a query-layer rule, not a serialization-layer one**: any function returning `bid_commercial` fields must itself check `now() > bid_due_date` (and, where two-envelope separation is configured, that technical evaluation is recorded) before including those fields — applies equally to every role, no exceptions (§9.6).
- Every state-changing endpoint writes to `audit_log` from inside the service function, not bolted on at the router (§14).

---

## 9. External Integrations

Per spec §13.1, all behind adapter interfaces with local mocks for now — never faked
as production integrations: Hospital ERP/Finance (PO file import, optional budget
check), Hospital Information System (requisition triggers, inbound only), Email/SMS
Gateway, Document/DMS Storage, GST/PAN Verification API, CAPTCHA provider, optional
Digital Signature provider.

---

## 10. Non-Functional Requirements

Per spec §14: role-based access + encrypted KYC/banking storage; immutable audit log;
99.5%+ bid-portal availability during active windows; eligibility resolution for 500
vendors × 100 line items within a few seconds; multi-facility support with shared or
facility-specific vendor pools; notifications on every status transition; 7+ year data
retention (to be confirmed); INR-only unless cross-border vendors are confirmed in scope.

---

## 11. Suggested Build Phases

1. **Foundation** — auth, RBAC, facility model, migrations, empty routers.
2. **Vendor lifecycle** — registration, documents, approval, product master, mapping, rating.
3. **Tender creation & approval** — draft, line items, eligibility resolver, E-Tender Approval gate, round tracking.
4. **Bidding** — submission, attachments, price-confidentiality enforcement, deadline locking.
5. **Evaluation & award** — technical/commercial ranking, QCBS, recommendation, L1 Approval gate, split-award.
6. **Post-award** — PO data file generation, ERP handoff states, vendor notification.
7. **Cross-cutting** — override engine, audit log, background jobs, notifications end-to-end.

---

## 12. Open Questions

Carried from `CLAUDE.md` (spec §17) plus items surfaced while writing this document:

1. Frontend framework choice — plain JS (as `index.html` already is) vs. introducing React/Vue/etc. Not specified by the user beyond "JS."
2. Auth mechanism — session vs. JWT.
3. Job runner — APScheduler assumed; revisit if the deployment needs multiple instances.
4. Final rating weights/thresholds per category (§5.2 values are illustrative).
5. Approval value bands per the hospital's real delegation-of-authority policy, including per-override-type bands (§12.3).
6. Vendor Mapping/Rating: group-wide vs. facility-specific by default (§2.3).
7. Item-line QCBS weight gap — §9.2.2's criteria table only assigns 65% of weight to Item-applicable criteria when an Item line is scored instead of pass/fail; no defined destination for the remaining 35%.
8. Upstream requisition source (HIS/ERP/manual).
9. Hospital ERP's exact PO-import format/fields (§10.4).
10. PO handoff automated (API/SFTP) vs. manual, and whether a return channel exists.
11. Digital signature requirement and provider.
12. Statutory data retention period.
