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

Defaults to a local SQLite file (`dev.db`) — zero setup, good for development.
For anything beyond local dev, point `DATABASE_URL` at a real Postgres instance
(create a `.env` file, or set the environment variable directly):

```
DATABASE_URL=postgresql+psycopg2://user:password@host:5432/hospital_procurement
```

Apply migrations:

```bash
python -m alembic upgrade head
```

Seed a facility + a Procurement Admin login for local testing:

```bash
python -m app.seed
# creates: admin@medsource.local / changeme123
```

## Run

```bash
python -m uvicorn app.main:app --reload --port 8000
```

- API docs: http://127.0.0.1:8000/docs
- Frontend (served from `../frontend/`, no separate server needed): http://127.0.0.1:8000/

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

## Not yet built

Tender creation/approval, bidding, evaluation, awards, PO export, the override
engine, audit log, notifications, background jobs (`IMPLEMENTATION-SPEC.md`
phases 3–7). Vendor login/auth (as opposed to staff login) also isn't built yet —
today, vendor registration and mapping requests are unauthenticated by vendor
identity (matching the spec's own model where a vendor doesn't yet have a
session); a vendor portal will be needed once vendor-facing endpoints (browsing
tenders, bidding) exist.
