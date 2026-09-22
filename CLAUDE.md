# Hospital E-Procurement System

Source of truth: **`E-Procurement-Spec-v2.md`** (project root) — the full functional
& technical specification from Mind IT Systems. `SPECIFICATIONS.md.txt` is an
older, much less detailed task-instructions document; where the two disagree,
`E-Procurement-Spec-v2.md` wins. This file is a condensed working reference to
that spec.

**Current stage: Phase 1 (Foundation) implementation has started.**
`wireframe/*.dc.html` (+ `wireframe/index.html`) remains the UI reference/click-through
prototype; `IMPLEMENTATION-SPEC.md` is the architecture/module/API/data-model plan.
Real code now lives in `backend/` (Python/FastAPI/SQLAlchemy/Alembic, see
`backend/README.md` for setup/run instructions and exactly what's built vs. not)
and `frontend/` (plain JS — no framework chosen yet, see IMPLEMENTATION-SPEC.md
§12 open question 1). The vendor registration → approval vertical slice (spec §3)
is built, tested, and working end-to-end; everything else in the spec is still
wireframe-only. Continue phase by phase per IMPLEMENTATION-SPEC.md §11 — don't
jump ahead to later phases without saying so first.

## Core lifecycle (7 stages, two are split into A/B approval gates)

1. Vendor Registration & Approval
2. Item/Asset/Service Master & Vendor Mapping
3. Vendor Rating & Scorecard
4A. E-Tender Creation & Selective Publishing (preparation, draft)
4B. E-Tender Approval (the gate that actually publishes + notifies vendors)
5. Bid Submission (vendor, line-item-wise, technical + commercial)
6. L1 Selection (technical T-rank, commercial L-rank, optional QCBS C-rank; Procurement Officer recommends)
7. L1 Approval & PO Data Handoff to ERP

Key distinctions the spec is strict about:
- **L1 confirmation is a recommendation, not an award.** Award happens only after L1 Approval (separate gate, Approving Authority).
- **E-Tender Approval gates publishing.** A tender must stay in Draft/pre-approval state until this succeeds; publish/vendor-notify/bidding-open only fire after approval. No direct-publish path exists from tender creation.
- **Split-Award (Spec §6.3.4, §9.5, §10.2) — in scope for Phase 1, was missing from the wireframe until this pass.** A line item flagged `Split-Award Allowed` at creation can have its quantity/value divided across more than one vendor (e.g. 70% to L1/C1, 30% to L2/C2), subject to a configured minimum split threshold. The Procurement Officer *proposes* the split at L1 Selection (§9.5); the Approving Authority *confirms or adjusts* it at L1 Approval (§10.2) — the Approving Authority has final say on the exact allocation, not just a yes/no. A split line item produces a separate PO data file entry per vendor, each carrying only that vendor's allocated share.
- **Multi-round approval with escalation (§7.3)**: every tender-approval and L1-approval submission is a numbered Round, not a single submit/approve cycle. Rejection returns it to Draft/re-evaluation with mandatory comments pinned to that round; resubmission creates the next round rather than overwriting history. A configurable max round count (or per-round SLA breach) auto-escalates to the next Approving Authority tier — this applies identically to both approval gates.
- **Open Tender (§6.8)**: a tender type that bypasses vendor *mapping and rating* eligibility filtering and publishes as a public self-registration link/QR code (no scoped vendor list). Still requires the same E-Tender Approval gate — only the meaning of "publish" changes.
- **Guest Invite (§6.7)**: officer can send a registration invite to a name/email not yet on the platform. **Deviates from spec here — see "PROJECT OVERRIDE" below.**
- **Price confidentiality (§9.6)**: commercial prices are masked from *everyone* (including Procurement Officer and Approving Authority) until the bid deadline passes — not just hidden in the frontend. Per-line-item due dates unlock independently. Technical submissions unlock first; prices unlock only after technical qualification is recorded.
- **ERP handoff is data export only** (CSV/XML, field structure in Spec §10.4) — this app does not create the ERP PO itself. One file per awarded vendor per tender.
- **Overrides don't touch the underlying record until Approved.** One reusable override/approval engine (Spec §12), not bespoke logic per module — states: Requested/Pending Approval/Approved/Rejected/Escalated/Expired. Spec §12.3 has the full table of override types (rating override, vendor add, expedited registration review — reframed from spec's "guest invite", see PROJECT OVERRIDE below —, technical score correction, late-submission exception, due-date extension, non-L1/C1 award override, PO re-export) with their default approver and escalation trigger.
- **Everything workflow/authorization/price/eligibility-related must be backend-enforced.** Never trust client-provided state, never rely on frontend button visibility alone to gate a transition.
- **Audit logging is first-class**, not scattered ad hoc logging: actor, role, action, affected entity, before/after state, timestamp, reason, approval decision, escalation path. Immutable from normal app workflows.
- **Multi-facility/multi-entity from the start (Spec §2.3)**: every tender carries a Facility/Legal Entity field; vendor mapping can be Group-wide or Facility-specific (hospital policy, not per-tender); the approval matrix can be defined per facility; PO data file carries a Facility/Entity Code.
- **Vendor rating (Spec §5.2, now with concrete illustrative weights, not just "configurable"):** On-time Delivery % 25% (manual), Quality Acceptance Rate 25% (manual), Price Competitiveness 20% (system-computed from this system's own bid history, rolling 12-month window), Compliance/Documentation Currency 15% (manual), Responsiveness 15% (manual). Only Price Competitiveness is automatic; overriding it is a governed override — routine manual entry of the other four is not. New vendors are "Unrated" until enough history exists; stale manual entries flag "Stale — Manual Update Due".
- **Technical evaluation precedes commercial (Spec §9.2–9.4)**: Qualify/Disqualify (default, Item lines) or Scored Technical Ranking (Asset/Service lines, T1/T2/T3…) happens first; commercial L-ranking runs only among technically-qualified bids; QCBS combined C-ranking (Combined Score = Technical%×Weight + Price%×Weight, common defaults 70/30 for critical Assets or 60/40 for Services) is an optional per-line-item alternative to plain L1, fixed at tender creation.

## PROJECT OVERRIDE — no bidding without full vendor approval (deviates from spec §6.7/§6.8)

**User-directed deviation from the base spec, confirmed explicitly — do not silently revert this.**

The spec's base design lets a vendor *bid* before completing KYC/Active approval in two places:
- §6.7 Guest Invite: officer invites an unregistered vendor → placeholder "Guest — Registration Incomplete" profile → can bid immediately → KYC/Active status only required later, before PO export.
- §6.8 Open Tender: any visitor self-registers on the public link → immediately granted bid access → same "prove KYC later, before award" deferral.

**This project does not allow that.** The rule here is: **no vendor may view or submit a bid on any tender — selective, manually-added, guest-sourced, or Open Tender — unless they are already an Active, approved vendor** (i.e., have been through Vendor Approval, screen 6, and passed). There is no "bid now, prove KYC later" path anywhere in this project, even though the base spec explicitly allows one.

What this changes vs. the base spec, concretely:
- **Open Tender landing page** now shows the *full* standard registration form (same as normal Vendor Registration) and routes into the same Pending Verification → Active approval queue — not a lightweight self-register-and-bid-immediately form. A visitor cannot bid until approved, same as anyone else. Open Tender still bypasses *mapping/rating* eligibility filtering (spec §6.8's actual point — anyone can respond, not just mapped/rated vendors) — it just no longer bypasses *registration/approval*.
- **Guest Invite** no longer creates a vendor that can bid pre-approval. It's now just a mechanism to *send someone a registration invite* — they only appear on any tender's eligible-vendor list once Procurement Admin has approved them as Active, same as any other vendor. There is no "Guest — Registration Incomplete, bidding permitted" state in this project.
- **E-Tender Approval's resolved eligible-vendor list must never contain an unregistered/unapproved vendor.** Every row on that screen is, by construction, an Active approved vendor — whether system-resolved, manually added, or sourced via a registration invite that has since been approved.
- The override type described in spec §12.3 as "Guest vendor invite (unregistered)" is reframed here as **"Expedited Registration Review"** — an override to *prioritize* a prospective vendor's registration review (so they clear approval before a tender's deadline), not to *bypass* approval.

If/when this moves into implementation, this means: the bid-submission API must check vendor status = Active server-side before accepting any bid, full stop — there is no code path where an unapproved vendor's bid is accepted contingent on later KYC completion.

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

Resolved by `E-Procurement-Spec-v2.md` (illustrative values, still to be finalized with actual hospital policy per Spec §17, but no longer "undefined placeholder"):
- ~~Vendor rating weighting~~ → Spec §5.2, weights above.
- ~~Who approves what~~ → Spec §11.2 value-based matrix: ≤₹1,00,000 Procurement Admin; ₹1,00,001–₹10,00,000 Department Head; above ₹10,00,000 Department Head + Finance/Management Committee (same bands for both E-Tender Approval and L1 Approval, resolved per facility).

Still genuinely open (Spec §17 — do not silently resolve, flag and ask):
1. Final rating weights/thresholds per category/criticality (§5.2 values are illustrative starting points).
2. Approval value bands per the hospital's actual delegation-of-authority policy, including per-override-type bands (§12.3).
3. Vendor Mapping/Rating Group-wide vs Facility-specific by default, and whether the approval matrix is shared group-wide or per facility (§2.3).
4. Split-Award: spec's own open question was Phase 1 vs Phase 2 — **resolved for this project: Phase 1, in scope now.**
5. Which upstream system (HIS/ERP/manual) originates the requisition seeding tender creation.
6. Hospital ERP's exact PO-import file format/field mapping (§10.4) — CSV or XML, column/element names, mandatory reference/budget codes.
7. PO data handoff automated (API/SFTP) or manual, and whether a return channel exists for the ERP to confirm the PO number back.
8. Whether digital signature/e-signing is mandatory for E-Tender Approval or L1 Approval records, and which provider.
9. Statutory data retention period (typically 7+ years, to be confirmed).

Any other spec ambiguity encountered during implementation — mark as `OPEN QUESTION` per the spec's own instruction rather than inventing a rule.

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
