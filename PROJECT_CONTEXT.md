# Project Context — Handoff for future Claude Code sessions

Read this first, then go deeper via: `CLAUDE.md` (working rules, PROJECT OVERRIDE,
ACTIVE QUESTIONS — **do not silently resolve anything listed there, ask**),
`E-Procurement-Spec-v2.md` (source of truth spec), `GAPS.md` (spec-vs-build gap
tracker, priority-ordered), `backend/README.md` (feature-by-feature build log).
This file is the "what's the state of the world" summary; those files are the
"why/details" ones — don't duplicate their content back into this file as it's
updated.

## What this is

A real Hospital E-Procurement System: vendor registration/KYC → item/asset/service
catalog + vendor↔catalog mapping → vendor rating → tender creation → E-Tender
Approval (publish gate) → vendor bidding → technical + commercial evaluation →
L1 Approval + PO data export to ERP. Built feature-by-feature, back-to-back,
per explicit user instruction — not polished as we go.

## Stack / architecture

- Backend: Python, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL (local Postgres via
  `backend/.env`, gitignored — see `backend/README.md` for setup). Served at
  `http://127.0.0.1:8000/`.
- Frontend: vanilla JS ES modules, no framework, no build step, served directly
  by FastAPI from `frontend/`. One module per page/tab under `frontend/js/pages/`
  (explicit user preference — never re-monolith this). `frontend/js/nav.js`'s
  `ROLE_TABS` is the single place staff role → visible tabs is defined.
  UI is the "Modernist" design system (Archivo font, accent `#ec3013`, radius 0,
  left sidebar) — see `DESIGN-REFERENCE.md`.
- Two entirely separate auth systems: staff JWT (`typ` unset) vs vendor JWT
  (`typ: "vendor"`) — each rejects the other's token at the dependency level
  (`app/security.py`).
- Windows `uvicorn --reload` is unreliable. Restart pattern: find the PID on
  port 8000 (`Get-NetTCPConnection -LocalPort 8000 -State Listen`), stop it,
  relaunch with `nohup uvicorn app.main:app --host 127.0.0.1 --port 8000 > uvicorn.log 2>&1 &`,
  curl `/docs` to confirm, delete the log. Never commit `uvicorn.log`.
- No browser-automation tool is available in this environment. Frontend changes
  are verified via `node --check` (syntax only) + careful manual review against
  proven patterns, and backend logic via API test scripts (urllib/requests —
  check which is installed; `requests`/`httpx` are NOT in the venv, stdlib
  `urllib` works). This is disclosed to the user each time, not silently assumed
  to be "tested".

## Critical, user-directed deviations from the base spec (do not silently revert)

All fully documented in `CLAUDE.md`'s "PROJECT OVERRIDE" section — read it
before touching vendor eligibility, bidding gates, or Guest Invite/Open Tender:

1. **No "bid now, prove KYC later" path anywhere**, except Guest Invite (see
   below). A vendor must be Active/approved before they can view or submit a
   bid on any tender — selective, manually-added, or Open Tender. This is a
   deliberate deviation from spec §6.7/§6.8's base design.
2. **Guest Invite (§6.7), decided 2026-09-24, NOT YET BUILT**: follows the
   reference prototype, not the rule above — guest may bid and be L1, but
   PO/ERP export is blocked until KYC completes and a second override approves
   it. When building this, keep server-side PO export blocked for guests.
3. **Open Tender (§6.8) is an open question** — not addressed by the Guest
   Invite decision. Ask before building: does it get the same deferred-KYC
   treatment, or does it keep full-registration-first?
4. **Qualify/Disqualify is a genuine toggle, not a hidden score** (reverted
   2026-09-28, explicit user direction) — any evaluator disqualifies → line
   disqualified, else qualified, no `spec_compliance` number, no T-rank. Scored/
   QCBS lines are unaffected and keep full weighted scoring.
5. Tender approval is Approving Authority only at every value band (not the
   3-band Procurement-Admin/Dept-Head/Committee split spec §11.2 literally
   describes) — user-directed.

Anything else in CLAUDE.md's ACTIVE QUESTIONS list is explicitly deferred —
if the topic comes up, ask; don't decide.

## Current implementation status (high level — GAPS.md has the authoritative detail)

**Built and working end-to-end:**
- Phase 1: vendor registration → approval, staff RBAC (6 roles), JWT auth (staff + vendor separately).
- Phase 2: Product Master (Item/Asset/Service), Vendor Mapping, Vendor Rating
  (Price Competitiveness now computed for real from bid history; other 4
  criteria are manual entry).
- Phase 3: tender draft/line-items (incl. all type-specific fields per
  §6.3.1-6.3.4), eligibility resolver, E-Tender Approval gate with multi-round
  escalation, per-line publish/hold-back.
- Phase 4: vendor login, full bid submission (drafts, typed commercial +
  technical fields, attachments, amend/withdraw), price sealing until deadline.
- Phase 5: two-stage technical (Qualify/Disqualify or Scored) → commercial
  (L1 or QCBS) evaluation, L1 recommendation, L1 Approval with Split-Award
  confirm/adjust, PO data file export (CSV/XML), vendor notifications.
- Manual Override & Exception Approval Workflow Engine (spec §12): generic
  engine built (`app/models/override.py`, `app/services/overrides.py`,
  `app/routers/overrides.py`). **3 of 8 override types wired** to actually
  mutate a target record on approval: Price Competitiveness override, PO
  re-export, Technical evaluation score correction. 5 remain unwired (each
  needs its own feature built first — see GAPS.md §2).
- Audit logging: immutable, insert-only, on every state-changing action.

**Two small temporary/demo additions (2026-09-28, both committed and pushed):**
- `POST /tenders/{id}/force-close-bidding` (System Admin only) — moves
  `bid_due_date` into the past to skip the real bidding window during demos.
  Explicitly marked in code as **temporary, remove when no longer needed** —
  not a spec feature.
- Bid's "Technical Compliance Statement" (spec §8.2) is now a tickbox
  ("meets the specification fully") + conditional deviations textarea (only
  shown/required when unticked), replacing an always-shown free-text field.
  This is a UX refinement of the same spec requirement, not a deviation —
  spec doesn't mandate a widget, only that compliance-to-spec is captured for
  RFP/technically-scored lines. `Bid.compliant_full` (new boolean column,
  migration `c1a2b3d4e5f6`) is the source of truth; server clears/re-requires
  the deviation text based on it.

**Not started (see GAPS.md §2 for full detail):**
- Guest Invite (§6.7) — decision made, not built.
- Open Tender (§6.8) — blocked on the open question above.
- Tender-side attachments from Procurement Officer (§6.4) — upload buttons are
  present but disabled by design; mandatory-attachment gate at submission is
  therefore also not enforced yet.
- Bid due-date extension and late-submission exception as governed overrides.
- Real email/SMS delivery (`app/services/notifier.py` logs instead of sending).
- Digital signature, GST/PAN verification API, CAPTCHA/anti-bot.

## Known gaps / smaller issues (not bugs, just incomplete per spec)

- Minimum qualifying technical score (60) and minimum split share (10%) are
  global constants, not per-line/hospital-configurable yet.
- No auto-flag when a vendor's rating falls below a critical floor (§5.4).
- Multiple technical evaluators are simple-averaged; "exclude-outlier"
  averaging (§9.2.3) isn't offered.
- Vendor's registration-time Category Declaration isn't used to pre-fill/
  auto-create mapping requests.
- Full GAPS.md list is priority-ordered; check there before assuming something
  is missing vs. just not yet reachable from the UI.

## Paused mid-discussion (needs a decision before building)

- **PO document generation for the vendor** ("My POs" tab / download on award
  notification). Base spec's boundary is CSV/XML data export only — the ERP
  makes the actual PO. Building an in-app vendor-facing PO document would be a
  deliberate deviation (same category as Guest Invite). Open questions: trigger
  point (at L1 approval vs. after ERP import confirms a real PO number) and
  format (styled HTML vs. a PDF-generation dependency).

## Immediate next steps

Nothing is actively "in progress" as of the last session — the two demo/UX
items above were completed, tested, committed, and pushed. Likely next work,
in the order the user has been working through GAPS.md:
1. Resolve the Open Tender vs. Guest-Invite-deviation question (ACTIVE
   QUESTIONS in CLAUDE.md), then build whichever of Guest Invite / Open Tender
   the user prioritizes.
2. Tender-side attachments (§6.4) + the mandatory-attachment submission gate —
   currently the most visible "looks built but isn't reachable" gap.
3. Wire the remaining 5 override types as their underlying features get built.

## Working process reminder (see CLAUDE.md for full version)

Describe/investigate → ask only when genuinely ambiguous (AskUserQuestion) →
build → test via API scripts (+ SQL for verification/cleanup, always restore
any demo data touched) → report → commit only when the user explicitly says
so, push only when explicitly told. One feature per commit, matching the
existing git log style. `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
on every commit.
