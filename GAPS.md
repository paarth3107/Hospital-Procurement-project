# Known Gaps vs. E-Procurement-Spec-v2.md

Produced from a full re-read of the spec against the actual code on 2026-09-28. Tracks work still
to do — check items off (or delete their section) as they're built. Priority order reflects impact,
not spec section order.

---

## 1. Built but not reachable from the UI (fix first)

**DONE (2026-09-28):** the tender header now has Publish Date, Minimum/Maximum vendors to invite,
and a new Terms & Conditions field (spec §6.2; `Tender.terms_and_conditions`, migration
`a3e6f0c2d9b4`); the review screen shows it and warns when a line's eligible-vendor count is below
the configured minimum (not a hard block -- spec §6.5 only describes behavior for Maximum, never for
Minimum). The line-item panel now has an "Evaluation & award" row exposing:
- **Technical evaluation method** (spec §9.2.1, §9.4) — Qualify/Disqualify / Scored / QCBS, defaulted
  by procurement type (Item -> Qualify/Disqualify, Asset/Service -> Scored, per §9.2.1's own stated
  default) and freely changeable. QCBS shows two weight inputs, defaulted to the spec's suggested
  70/30 (Asset) / 60/40 (Service) starting points; `LineItemCreate` now rejects a QCBS line with no
  positive weights at save time instead of only failing later at commercial-evaluation time.
- **Split-Award allowed** checkbox (spec §6.3.4).
- **Per-line minimum rating threshold override** (spec §6.3.4), blank = tender default.

~~**Still not reachable:** the rest of §6.3.1-6.3.3's type-specific line fields...~~ → **DONE
(2026-09-28).** `app/schemas/line_details.py` mirrors `product_attrs.py`'s exact pattern
(`ItemLineDetails` / `AssetLineDetails` / `ServiceLineDetails`, `LINE_DETAILS_BY_TYPE`, all fields
optional, `extra="forbid"`), validated in `LineItemCreate.clean_line_details()`. Frontend:
`frontend/js/pages/tenders/lineDetailFields.js` (the three field lists) rendered generically by
`tenderLineItems.js` via the catalog form kit's `fieldHtml`/`readFields`/`wireConditionalFields`
(`formKit.js`, which gained a `date` kind for this). Covers every field spec §6.3.1-6.3.3 names:
Item — HSN/SAC code, alternate-brand-allowed, delivery date/location, technical-spec override notes.
Asset — required certifications, brand restriction, warranty months, AMC/CMC arrangement,
installation notes, training required/details, spares commitment, exchange/buy-back, delivery/
installation date & location. Service — SOW, tenure, renewal terms, SLA response/uptime/resolution/
penalty, billing basis, manpower deployment norms, background verification, insurance, exit/
transition clause, service locations. `delivery_location` uses the exact same key
`app/services/po_files.py` already read (previously always `None`) for both Item and Asset, so the PO
data file's "Delivery / Service Terms" field is no longer always blank for those types. The E-Tender
Approval review screen already rendered `line_details` generically (`reviewPanel.js`'s `kv()`), so no
review-screen change was needed. **Simplification, not silently dropped:** spec §6.3.3's "License / IP
Terms (Software lines)" bullet mostly repeats the catalog's existing per-product software sub-schema
(license type/tenure, seats, escrow, IP assignment, data residency — `product_attrs.py`'s
`ServiceAttrs`); re-modeling all of that again per tender line was judged disproportionate for the
value, so it's one free-text `license_ip_terms_notes` field instead — this tender's own adjustment
notes on top of the master record, same shape as Item's `technical_spec_override`.
Verified end-to-end via API (all 3 types round-trip correctly, an unknown/wrong-type key is rejected
422, the approval-review endpoint surfaces it) — **not visually verified in a browser** (no
browser-automation tool available this session); JS syntax-checked with `node --check` only.

---

## 2. Whole modules not started

- ~~Manual Override & Exception Approval Workflow Engine (spec §12)~~ → **ENGINE BUILT; 2 of 8 override
  types wired to actually apply on Approved, 6 remain.** `app/models/override.py`,
  `app/services/overrides.py`, `app/routers/overrides.py` (`/api/v1/overrides`) implement the full
  generic Requested → Pending Approval → Approved/Rejected/Escalated/Expired state machine (spec
  §12.4), role/tier resolution + value-band escalation-at-request-time + manual escalation + lazy
  SLA-breach auto-escalate/expire (spec §12.5), and audit logging (spec §12.6). `OverrideTypeConfig`
  (seeded in `app/seed.py`) holds spec §12.3's table as hospital-configurable data. **Wired** (see
  `backend/README.md` for the full writeup): Price Competitiveness override (`ratings.py`), Technical
  evaluation score correction (`evaluation.py` — also refactored `technical_evaluation.py`'s
  consolidation into a reusable `consolidate_line()`, and correctly recomputes/cleans up affected
  `price_competitiveness_records` when a correction changes the qualified set). **PO data file
  re-export was wired, then removed 2026-09-28** (user-directed — `mark-imported`/`mark-failed`/
  re-export are out of scope for now; see `backend/README.md`'s "PO data files" section). **Not wired
  yet** — each needs a feature built first, not just a hook:
  invite-list manual add (§6.6), guest vendor invite (§6.7, decision already made — see below),
  late-submission exception (§8.4), bid due-date extension (§9.6), PO data file re-export (now back in
  this bucket). **Non-L1/Non-C1 award override is a special case, not just unwired** — it's *already* a
  working, tested direct-decision flow (Approving Authority picks L1 or the Officer's alternate at L1
  Approval) that predates this engine; retrofitting it to route through here instead would be a
  behavior change to a shipped flow, not just wiring, so it needs its own conversation before touching
  it.
- **Guest Invite (spec §6.7).** Not started. CLAUDE.md already records the user's override decision
  (follow the reference prototype: guest may bid, PO blocked until KYC) — decision made, not built.
- **Open Tender (spec §6.8).** Public self-registration link/QR, not started. Open question: whether
  it follows the same guest-invite deviation or keeps full-registration-first (CLAUDE.md ACTIVE
  QUESTIONS).
- **Tender-side attachments (spec §6.4).** Header/line-item documents from the Procurement Officer.
  The line-item form shows a checklist but every Upload button is disabled by design.
  Mandatory-attachment gate at submission (spec §6.9 point 2) is consequently also not enforced.
- **Bid due-date extension as a governed override (spec §9.6).** No endpoint to extend a published
  tender's deadline. Only path today is withdraw-to-draft (blocked once any bid exists) + a full new
  E-Tender Approval round.
- **Late-submission exception (spec §8.4).** A bid past the deadline is simply rejected; no override
  path to admit it.
- **Real email/SMS delivery.** Every notification (registration status, tender invite, publish,
  award, regret, technical disqualification, due-date extension) is portal-only.
  `app/services/notifier.py` logs instead of sending, by design so far (spec §13.1 Email/SMS Gateway
  adapter not built).

---

## 3. Real but smaller gaps

- ~~Price Competitiveness is hardcoded to 50, permanently~~ → **RESOLVED.** Now computed for real
  (spec §5.1/§5.3) when a line's technical evaluation closes: each technically-qualified bid's landed
  price is scored against the line's lowest landed price (same 0-100 formula as commercial L-ranking),
  written to a new `price_competitiveness_records` row per bid, then averaged per vendor over a
  rolling 12-month window into `vendor_ratings.price_competitiveness` (`app/services/ratings.py`,
  called from `close_technical_evaluation()` in `app/routers/evaluation.py`). Lines with fewer than 2
  qualified bids don't compute a score (nothing to compare against) and the vendor keeps the
  provisional default. Audited as `rating.price_competitiveness_updated`.
- No "vendor's rating falls below a critical floor -> auto-flag for suspension review" (spec §5.4).
- Minimum qualifying technical score (60, `technical_evaluation.py`) and minimum split share (10%,
  `awards.py`'s `MIN_SPLIT_PCT`) are global constants, not per-line/hospital-configurable as the spec
  calls for — expected per the open questions, just flagging they're still hardcoded.
- Multiple technical evaluators are only simple-averaged; "exclude-outlier" averaging (spec §9.2.3
  point 3, the spec's other named method) isn't offered.
- Vendor's registration-time Category Declaration field is stored but never used to pre-fill or
  auto-create mapping requests on approval (parked earlier by the user).
- Mapping requests can't carry a free-text supporting-document upload (spec §4.3 point 1) —
  superseded in spirit by the catalog-defined "required documents" system (user-directed), but the
  literal "attach any evidence you like" path doesn't exist.
- Digital signature (spec §13.1, open question #8), GST/PAN verification API (open question,
  §13.1/§13.2), CAPTCHA/anti-bot (§13.1) — not built; the latter two are only relevant once Open
  Tender exists.

---

## 4. In discussion, not yet decided

- **PO document generation for the vendor** ("My POs" tab, download button on the award
  notification). The base spec's boundary is that this app only produces the CSV/XML data file for
  the ERP — PO document creation/numbering/issuance/dispatch happen inside the ERP (spec §10.1,
  §10.7, §16). Building an actual vendor-facing PO document in this app is a deliberate deviation,
  same category as the guest-invite override. Needs a decision on: trigger point (right at L1
  approval vs only after Procurement Admin confirms ERP import with a real PO number) and format
  (styled HTML doc vs adding a PDF-generation dependency). Paused mid-discussion.
