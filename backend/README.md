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

## What's implemented so far (Phase 1 — Foundation)

- Project skeleton, config, DB session management, Alembic migrations.
- `UserAccount` + RBAC (`require_role` dependency) covering the 6 staff roles from spec §11.1.
- JWT login (`/api/v1/auth/login`, `/api/v1/auth/me`).
- The full **vendor registration → approval** vertical slice end-to-end (spec §3), including:
  - Duplicate-GSTIN rejection (§3.5).
  - The full status state machine (§3.4) with a guard against re-deciding an already-decided vendor.
  - Mandatory rejection reason (§3.5).
  - This is also the single registration path Open Tender's public landing page will call later — there is no lightweight/guest variant (CLAUDE.md PROJECT OVERRIDE).
- A minimal real (not mockup) frontend exercising this same API — registration form, staff login, and an approval queue with working Approve/Reject/Request Info actions.

## Not yet built

Everything else in `IMPLEMENTATION-SPEC.md`'s later phases: product master, vendor
mapping, rating, tender creation/approval, bidding, evaluation, awards, PO export,
the override engine, audit log, notifications, background jobs. Vendor login/auth
(as opposed to staff login) also isn't built yet — it'll be needed once vendor-facing
endpoints (browsing tenders, bidding) exist.
