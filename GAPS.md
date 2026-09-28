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

**Still not reachable:** the rest of §6.3.1-6.3.3's type-specific line fields (required delivery
date/location, HSN/SAC code, warranty/AMC requirement, installation/training/spares terms, SOW/SLA/
billing basis, alternate-brand-allowed) still live only in the untyped `TenderLineItem.line_details`
JSON bag with no UI to fill it. Plan (agreed, not yet built): mirror the catalog's
`type_specific_attrs` / `ATTRS_BY_TYPE` pattern (`app/schemas/product_attrs.py`) with an
analogous per-type schema for tender line details, rendered generically on the frontend from that
schema, rather than hand-building each field. Lower urgency than the items above since nothing
evaluates against this content programmatically today (the scoring criteria are fixed spec
constants) -- it's descriptive/contractual text, not something the app acts on. Delivery
date/location is the one exception worth doing early, since it feeds the PO data file's currently-
always-blank "Delivery / Service Terms" field.

---

## 2. Whole modules not started

- ~~Manual Override & Exception Approval Workflow Engine (spec §12)~~ → **ENGINE BUILT, not yet
  wired into any of the 8 override types' target records.** `app/models/override.py`,
  `app/services/overrides.py`, `app/routers/overrides.py` (`/api/v1/overrides`) implement the full
  generic Requested → Pending Approval → Approved/Rejected/Escalated/Expired state machine (spec
  §12.4), role/tier resolution + value-band escalation-at-request-time + manual escalation + lazy
  SLA-breach auto-escalate/expire (spec §12.5), and audit logging (spec §12.6) — see `backend/README.md`
  for the full writeup and what "not wired" means concretely. `OverrideTypeConfig` (seeded in
  `app/seed.py`) holds spec §12.3's table as hospital-configurable data. Still to do, per override
  type: the actual "apply this to the target record on Approved" adapter (e.g. technical score
  correction should re-open a closed line's score; PO re-export should require approval before
  `po_files.re_export()` runs instead of after) — each is its own small piece of wiring against an
  already-built feature, deferred as a deliberately separate pass (user-directed 2026-09-28: build the
  engine first, wire types in one at a time later). Non-L1/Non-C1 award override is a special case —
  it's *already* a working, tested direct-decision flow (Approving Authority picks L1 or the
  Officer's alternate at L1 Approval) that predates this engine; retrofitting it to route through here
  instead would be a behavior change to a shipped flow, not just wiring, so it needs its own
  conversation before touching it.
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
