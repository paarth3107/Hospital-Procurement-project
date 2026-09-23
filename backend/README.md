# Backend — Hospital E-Procurement API

Python + FastAPI + SQLAlchemy + Alembic. See `IMPLEMENTATION-SPEC.md` at the
project root for the full architecture/API/data-model plan this is built from.

## Setup

```bash
python -m venv venv
venv/Scripts/activate          # Windows; use `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
```

## Database

Falls back to a local SQLite file (`dev.db`) with zero setup if `DATABASE_URL`
isn't set — this local checkout instead runs against a real local Postgres
instance via `backend/.env` (gitignored, not committed):

```
DATABASE_URL=postgresql+psycopg2://hospital_app:<password>@127.0.0.1:5432/hospital_procurement
```

`hospital_app` is a dedicated, least-privilege role (owns only the
`hospital_procurement` database) — the app never connects as the Postgres
superuser. To recreate this locally from scratch (e.g. a fresh machine):

```sql
CREATE ROLE hospital_app LOGIN PASSWORD '...';
CREATE DATABASE hospital_procurement OWNER hospital_app;
```

Apply migrations:

```bash
python -m alembic upgrade head
```

Seed a facility, a Procurement Admin login, and one demo login per other
staff role (for exercising the role-scoped frontend nav locally):

```bash
python -m app.seed
# creates: admin@medsource.local / changeme123  (Procurement Admin)
#          officer@medsource.local / changeme123  (Procurement Officer)
#          category@medsource.local / changeme123  (Category Manager)
#          authority1@medsource.local / changeme123  (Approving Authority, tier 1)
#          authority3@medsource.local / changeme123  (Approving Authority, tier 3)
#          sysadmin@medsource.local / changeme123  (System Admin)
```

## Run

```bash
python -m uvicorn app.main:app --reload --port 8000
```

- API docs: http://127.0.0.1:8000/docs
- Frontend (served from `../frontend/`, no separate server needed): http://127.0.0.1:8000/

## Frontend nav is role-scoped

`frontend/app.js`'s `ROLE_TABS` map shows each staff role only the tabs it can
actually use, driven directly off each router's `require_role(...)`/
`get_current_user` gates (not a separate guess at what each role "should"
see): Procurement Officer -> Tenders; Category Manager -> Product Catalog,
Vendor Mapping, Vendor Rating (read-only — the "Save Manual Ratings" form is
hidden since that endpoint is Procurement Admin-only); Procurement Admin /
System Admin -> everything; Approving Authority -> E-Tender Approval only.
Vendor Registration / Staff Login tabs hide once logged in as staff. Add a
new tab by adding it to `ALL_STAFF_TAB_VIEWS` and listing it under whichever
roles' arrays in `ROLE_TABS` — one line, not a scattered set of role checks.

## What's implemented so far

### Phase 1 — Foundation

- Project skeleton, config, DB session management, Alembic migrations.
- `UserAccount` + RBAC (`require_role` dependency) covering the 6 staff roles from spec §11.1.
- JWT login (`/api/v1/auth/login`, `/api/v1/auth/me`).
- The full **vendor registration → approval** vertical slice end-to-end (spec §3), including:
  - Duplicate-GSTIN rejection (§3.5).
  - The full status state machine (§3.4) with a guard against re-deciding an already-decided vendor.
  - Mandatory rejection reason (§3.5).
  - This is also the single registration path Open Tender's public landing page will call later — there is no lightweight/guest variant (CLAUDE.md PROJECT OVERRIDE).

### Phase 2 — Vendor lifecycle continuation

- **Product Master** (spec §4.2): Item/Asset/Service catalog, unique code, type-specific attributes as a JSON bag, active/inactive toggle. `POST/GET /api/v1/products`, activate/deactivate endpoints.
- **Vendor Mapping** (spec §4.3): many-to-many vendor↔catalog eligibility, full Pending→Approved/Rejected/Suspended state machine, versioned with a complete history log (every transition, including the initial request, is recorded with `from_state`/`to_state`/reason/actor). `POST /api/v1/mappings` (request — enforces CLAUDE.md PROJECT OVERRIDE: only an already-Active vendor may request a mapping), `approve`/`reject`/`suspend` gated to Category Manager/Procurement Admin, `GET .../history`.
- **Vendor Rating** (spec §5.2/§5.3): weighted composite score (`RATING_WEIGHTS` in `app/models/vendor_rating.py`, illustrative per spec §5.2 — open question, see CLAUDE.md), re-normalized when manual sub-scores are missing, `is_provisional` flag, full history of manual entries. `GET /api/v1/ratings/{vendor_id}` (lazy-creates a provisional row), `PATCH` for manual entry (Procurement Admin only) with a mandatory comment enforced server-side when a value changes by more than `MATERIAL_CHANGE_THRESHOLD`. `price_competitiveness` is deliberately not writable through this endpoint — overriding it is a governed override (spec §5.3.1 point 4) that routes through the override/approval engine once that's built (Phase 7), not ordinary data entry.
- Frontend gained three more real (not mockup) screens on the same pattern as the vendor queue: Product Catalog, Vendor Mapping queue, and a Vendor Rating lookup/edit screen.

### Phase 3 — Tender creation & E-Tender Approval

- **Tender + Line Items** (spec §6.2/§6.3): draft creation, line items scoped to Item/Asset/Service catalog entries (rejects a mismatched procurement_type), line items only editable while Draft. Type-specific fields (SOW, warranty, SLA, etc. — spec §6.3.1-6.3.3) are a JSON bag on the line item (`line_details`), same pattern as `ProductMaster.type_specific_attrs`. **Not built this phase**: header/line attachments and their mandatory-attachment checklist (spec §6.4) — grouped with Bidding's attachment handling (Phase 4) instead of duplicating file-upload plumbing across two phases.
- **Eligibility Resolver** (spec §6.5, `app/services/eligibility.py`): Active vendor -> Approved mapping -> rating >= threshold (line override or tender default) -> ranked by rating desc and capped at `max_invites`. `GET /tenders/{id}/eligibility-preview` recomputes live; `GET /tenders/{id}/invites` returns the persisted snapshot taken at the last submit/approve. A line item with zero eligible vendors unconditionally blocks submission/approval (spec §6.5) — there's no manual-vendor-add override path yet (spec §6.6), deliberately deferred until the override/approval engine exists (Phase 7) rather than building bespoke override logic just for tenders.
- **Value-based Approval Matrix** (spec §11.2, `app/services/approval_matrix.py`): configurable `ApprovalBand` rows (seeded with the spec's illustrative ≤1L / 1L-10L / >10L bands, not hardcoded) resolve a tender's total estimated line-item value to a numeric tier. Tier 1 maps to Procurement Admin; tiers 2/3 map to the Approving Authority role disambiguated by a new `UserAccount.approval_tier` column, since this system has one Approving Authority role, not the spec's illustrative "Department Head" / "Finance Committee" as separate roles (CLAUDE.md open question 2).
- **E-Tender Approval gate + Round Tracking** (spec §7): `submit-for-approval` snapshots the resolved tier onto a new `TenderApprovalRound`; `approve` re-runs the eligibility check (spec §5.9 "approval-time re-check") before publishing; `reject` requires comments and returns the tender to Draft without touching prior rounds. Three consecutive rejections auto-escalate the next round's required tier by one (spec §7.3 point 5; the count is an illustrative default, `MAX_ROUNDS_BEFORE_ESCALATION`, not a spec value). **Not built this phase**: per-round SLA-timeout escalation (needs a background scheduler, Phase 7) and Open Tender / Guest Invite (spec §6.7/§6.8 — both need their own public/self-registration flow, deferred).
- Frontend gained a Tenders screen (create draft, add line items, eligibility preview, submit) and an E-Tender Approval queue screen (approve/reject with the resolved tier shown), on the same real-API pattern as the rest.

## Not yet built

Bidding, evaluation, awards, PO export, the override engine, audit log,
notifications, background jobs (`IMPLEMENTATION-SPEC.md` phases 4–7); Open
Tender and Guest Invite within tendering (see Phase 3 notes above). Vendor
login/auth (as opposed to staff login) also isn't built yet — today, vendor
registration and mapping requests are unauthenticated by vendor identity
(matching the spec's own model where a vendor doesn't yet have a session); a
vendor portal will be needed once vendor-facing endpoints (browsing tenders,
bidding) exist.
