# Hospital E-Procurement System

Source of truth: `SPECIFICATIONS.md.txt` (project root). This file is a condensed
working reference to that spec — if the two ever disagree, the spec wins.

**Current stage: wireframe only** (`wireframe/*.dc.html`, published as a Design
canvas Artifact). No application code has been written. Do not start
implementation until the user explicitly says to move into Phase 0/1 — see
"Working process" below.

## Core lifecycle (12 stages)

Vendor Registration → Vendor Approval → Item/Asset/Service Mapping → Vendor
Rating → E-Tender Creation → E-Tender Approval → Selective Publishing → Bid
Submission → Technical/Commercial Evaluation → L1 Selection → L1 Approval →
PO Data Export → ERP Handoff

Key distinctions the spec is strict about:
- **L1 confirmation is a recommendation, not an award.** Award happens only after L1 Approval (separate gate).
- **E-Tender Approval gates publishing.** A tender must stay in draft/pre-approval state until this succeeds; publish/vendor-notify/bidding-open only fire after approval.
- **Price confidentiality**: commercial prices must not be exposed via the API (not just hidden in the frontend) before the bid deadline / before technical qualification is recorded, whichever the spec's sequencing requires.
- **ERP handoff is data export only** (CSV/XML, configurable field structure) — this app does not create the ERP PO itself unless that integration is explicitly added later.
- **Overrides don't touch the underlying record until Approved.** One reusable override/approval engine, not bespoke logic per module (states: Pending/Approved/Rejected/Escalated/Expired; reason codes, approval bands, escalation, SLA expiry, full audit trail).
- **Everything workflow/authorization/price/eligibility-related must be backend-enforced.** Never trust client-provided state, and never rely on frontend button visibility alone to gate a transition.
- **Audit logging is first-class**, not scattered ad hoc logging: actor, role, action, affected entity, before/after state, timestamp, reason, approval decision, escalation path. Audit history is immutable from normal app workflows.
- **Multi-facility/multi-entity from the start**: entities carry facility/legal entity/department, and approval resolution can depend on those — don't design the schema in a way that forecloses this later.
- **Vendor rating** has both automatic (price competitiveness, derived from this system's historical bid data) and manual components (on-time delivery %, quality acceptance rate, compliance currency, responsiveness), with history retained, provisional/stale states, configurable weighting, and governed override of the automatic value.

## Roles

Vendor, Procurement Officer, Procurement Admin, Category Manager / Technical
Evaluator, Approving Authority, System Admin. Approval authority can depend on
tender value / facility / legal entity / configured bands — model as config, not
a hardcoded hierarchy.

## Integration boundaries (adapters + mocks locally, not faked)

Hospital ERP/Finance, Hospital Information System, Email/SMS gateway,
Document/DMS storage, optional Digital Signature provider (for E-Tender
Approval and L1 Approval).

## Known open questions (do not silently resolve — flag and ask)

- Exact weighting between price and vendor rating for the recommendation score (spec explicitly leaves rating weighting configurable; the wireframe's `canvas.json` `note-scoring` annotation flags this as still placeholder).
- Who counts as a "senior official" for reject/escalation approval, and how many tiers exist (wireframe `canvas.json` `note-escalation` annotation).
- Any other spec ambiguity encountered during implementation — mark as `OPEN QUESTION` per the spec's own instruction rather than inventing a rule.

## Working process (per the spec, section 15–16)

1. Phase 0 is an implementation analysis (architecture, module map, ER/data
   model, state machines, API plan, open questions) — produced *before*
   writing app code, not skipped.
2. Then build incrementally by phase (Foundation → Vendor Mgmt → Rating →
   Tender → Bidding → Evaluation → Approval+ERP → Cross-cutting), not all at
   once.
3. Before each phase: explain what's being built, cite the relevant spec
   requirements, explain architectural decisions, state assumptions — then
   implement, test, and summarize what changed and how to verify it locally.
4. Definition of done per feature: works through the UI, API functional,
   backend authorization enforced, validated, migrated, critical transitions
   tested, audit events recorded, error cases handled, explainable/maintainable.

## Coding behavior

Simple, explicit implementations over clever abstractions. No premature
optimization, no unnecessary dependencies (justify any addition). Centralize
and test business rules rather than duplicating workflow logic across
modules. Don't hardcode hospital-specific approval values the spec calls
configurable.

## Wireframe-specific note

Per user preference: keep the wireframe (`wireframe/*.dc.html`) structurally
correct first; do not spend effort on visual polish/beautification until the
underlying screen flow and structure are confirmed.
