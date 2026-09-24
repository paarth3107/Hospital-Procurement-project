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

## Frontend file structure

`frontend/js/` is real ES modules (`<script type="module">` in `index.html`, entry point `js/main.js`) -- previously one 1900-line `app.js`, split one file per page/tab per explicit request, so a broken screen means opening one small file, not searching one giant one:

- `js/api.js`, `js/state.js`, `js/ui.js`, `js/modal.js`, `js/constants.js` — shared primitives (the `api()` fetch wrapper, the shared mutable `state` object, `showResult()`, the in-page modal, and cross-page constants like `VENDOR_DOC_TYPES`/`MAPPING_STATE_PRIORITY`).
- `js/nav.js` — the router: `switchView()`, `ROLE_TABS`/`DEFAULT_VIEW_BY_ROLE`, and the three nav-visibility functions (`showStaffTabsForRole`, `showVendorDashboardTab`, `resetToLoggedOutNav`). Imports every page module's load/render function to dispatch to on `switchView()`.
- `js/pages/*.js` — one file per tab/screen (`registerPage.js`, `staffLoginPage.js`, `vendorLoginPage.js`, `dashboardPage.js`, `vendorQueuePage.js`, `catalogPage.js`, `mappingsPage.js`, `ratingsPage.js`, `tendersPage.js`, `approvalsPage.js`, `vendorDocumentsPage.js`, `vendorProfilePage.js`, `vendorCategoriesPage.js`, `vendorDashboardPage.js`). Each wires its own event listeners as a side effect of being imported and exports only what `nav.js` (or another page, e.g. the vendor dashboard's "Go to Categories" button) needs to call into it.
- `js/main.js` — imports every page module (for their wiring) plus `nav.js`, then runs the session-restore logic on load.

`nav.js` and the page modules import each other (nav dispatches into pages; pages call `switchView()` to navigate) -- this is a circular import, but a safe one: every cross-module reference happens inside a function or event-handler body, never at a module's top level, so there's no "used before initialized" risk. Verified by actually loading the full graph under Node with a stub DOM (`node --check` per file, then a real `import()` of `main.js`) before this was committed.

## Landing page

The unauthenticated default view is now a real split landing page
(`view-landing`), not whichever public form happened to load first --
Hospital Staff panel (Staff Login) and Vendor panel (Vendor Login / Register
as a Vendor). The brand/logo in the top bar and a "← Back to home" link on
each of those three destination screens both return to it. Landing is the
*only* way into those three screens now -- the persistent nav tabs for them
were retired as pure duplication once landing existed.

The old public, unauthenticated "Request a Mapping" page (type-your-own-
vendor-ID) was retired outright, not just unlisted -- the vendor dashboard's
authenticated category picker (Phase 4) does the same job strictly better
(real identity, no ID to type or typo) via the same, unchanged `POST
/mappings`. That endpoint itself is untouched; only the public form that
called it without login is gone.

## Frontend nav is role-scoped

`frontend/js/nav.js`'s `ROLE_TABS` map shows each staff role only the tabs it can
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
- **Vendor Rating** (spec §5.2/§5.3): weighted composite score (`RATING_WEIGHTS` in `app/models/vendor_rating.py`, illustrative per spec §5.2 — open question, see CLAUDE.md), re-normalized when manual sub-scores are missing, `is_provisional` flag, full history of manual entries. `GET /api/v1/ratings/{vendor_id}` (lazy-creates a provisional row), `PATCH` for manual entry (Procurement Admin only) with a mandatory comment enforced server-side when a value changes by more than `MATERIAL_CHANGE_THRESHOLD`. `price_competitiveness` is deliberately not writable through this endpoint — overriding it is a governed override (spec §5.3.1 point 4) that routes through the override/approval engine once that's built (Phase 7), not ordinary data entry. `VendorRating.is_stale` (spec §5.3.1 point 5, `STALE_AFTER_DAYS`) flags a rating whose manual parameters haven't been refreshed in 90 days, exposed on `RatingOut` — the frontend's Vendor Rating tab leads with a fleet-wide dashboard (average score, provisional/stale counts, a score-sorted leaderboard) matching the wireframe's per-vendor breakdown-card layout instead of a lookup-only form.
- Frontend gained three more real (not mockup) screens on the same pattern as the vendor queue: Product Catalog, Vendor Mapping queue, and a Vendor Rating lookup/edit screen.

### Phase 3 — Tender creation & E-Tender Approval

- **Tender + Line Items** (spec §6.2/§6.3): draft creation, line items scoped to Item/Asset/Service catalog entries (rejects a mismatched procurement_type), line items only editable while Draft. Type-specific fields (SOW, warranty, SLA, etc. — spec §6.3.1-6.3.3) are a JSON bag on the line item (`line_details`), same pattern as `ProductMaster.type_specific_attrs`. **Not built this phase**: header/line attachments and their mandatory-attachment checklist (spec §6.4) — grouped with Bidding's attachment handling (Phase 4) instead of duplicating file-upload plumbing across two phases.
- **Eligibility Resolver** (spec §6.5, `app/services/eligibility.py`): Active vendor -> Approved mapping -> rating >= threshold (line override or tender default) -> ranked by rating desc and capped at `max_invites`. `GET /tenders/{id}/eligibility-preview` recomputes live; `GET /tenders/{id}/invites` returns the persisted snapshot taken at the last submit/approve. A line item with zero eligible vendors unconditionally blocks submission/approval (spec §6.5) — there's no manual-vendor-add override path yet (spec §6.6), deliberately deferred until the override/approval engine exists (Phase 7) rather than building bespoke override logic just for tenders.
- **Value-based Approval Matrix** (spec §11.2, `app/services/approval_matrix.py`): configurable `ApprovalBand` rows (seeded with the spec's illustrative ≤1L / 1L-10L / >10L bands, not hardcoded) resolve a tender's total estimated line-item value to a numeric tier. Tier 1 maps to Procurement Admin; tiers 2/3 map to the Approving Authority role disambiguated by a new `UserAccount.approval_tier` column, since this system has one Approving Authority role, not the spec's illustrative "Department Head" / "Finance Committee" as separate roles (CLAUDE.md open question 2).
- **E-Tender Approval gate + Round Tracking** (spec §7): `submit-for-approval` snapshots the resolved tier onto a new `TenderApprovalRound`; `approve` re-runs the eligibility check (spec §5.9 "approval-time re-check") before publishing; `reject` requires comments and returns the tender to Draft without touching prior rounds. Three consecutive rejections auto-escalate the next round's required tier by one (spec §7.3 point 5; the count is an illustrative default, `MAX_ROUNDS_BEFORE_ESCALATION`, not a spec value). **Not built this phase**: per-round SLA-timeout escalation (needs a background scheduler, Phase 7) and Open Tender / Guest Invite (spec §6.7/§6.8 — both need their own public/self-registration flow, deferred).
- Frontend gained a Tenders screen (create draft, add line items, eligibility preview, submit) and an E-Tender Approval queue screen (approve/reject with the resolved tier shown), on the same real-API pattern as the rest.

### Phase 4 (started) — Vendor login + basic Bid Submission

- **Vendor authentication** (`app/security.py`): a vendor sets a password at registration (`VendorCreate.password`, min 8 chars) and logs in with GSTIN + password at `POST /api/v1/vendor-auth/login`. Vendor JWTs carry `"typ": "vendor"` (staff tokens have none/`"staff"`), checked by both `get_current_user` and the new `get_current_vendor` dependency, so a vendor's token can never authorize a staff-only endpoint or vice versa. `GET /api/v1/vendor-auth/me` returns the vendor's own profile (including `rejection_reason` if rejected — a vendor should be able to see why). No password-reset flow exists yet (needs the Email/SMS adapter, not built).
- **Bid model + submission** (`app/models/bid.py`, spec §8): one `Bid` per (vendor, tender line item), gated by every check spec §5.6 calls "the most heavily gated function in the system" — vendor must be Active, the tender must be Published, the vendor must be on that line item's resolved invite list (`TenderInvite`), the bid deadline must not have passed, and a vendor can only bid once per line item (no amend/withdraw yet). `GET /api/v1/vendor-portal/tenders` lists Published tenders the vendor is invited to, tagged with whether they've already bid; `GET /api/v1/vendor-portal/bids` lists the vendor's own bid history; `POST /api/v1/vendor-portal/bids` submits one.
- **Not built in this pass**: technical bid submissions/attachments, bid amendment or withdrawal, and — importantly — price confidentiality enforcement for anyone *other* than the bidding vendor (spec §9.6). There's no staff-facing bid-read endpoint yet at all, so nothing currently leaks a price prematurely, but that's an absence of a feature, not the real masking-until-deadline rule the spec requires; building any staff/evaluation view of bids (Phase 5) must implement that rule at the query layer before it reads a single `Bid.unit_price`.
- **Staff Dashboard** (`app/routers/dashboard.py`, matches `wireframe/Main.dc.html`): `GET /api/v1/dashboard/stats` returns real, computed numbers only — Open Tenders (Published, deadline not passed), Pending Your Approval (tenders in Pending Approval that *this specific user's role/tier* can act on, reusing the same `can_approve_tier()` predicate `tenders.py`'s approve endpoint enforces — not just a global pending count), Vendors Pending Approval, Registered Vendors, and Bids Submitted (a real substitute for the wireframe's "Awarded This Month", since Award/Phase 6 doesn't exist yet and that stat can't be faked). Only aggregate bid *counts* are exposed here, never `Bid.unit_price` — same price-confidentiality boundary as the rest of Phase 4. It's now every staff role's landing page after login.

### Vendor onboarding redesign (in progress, building step by step per user request)

Registration → document upload/verification → categories → dashboard, replacing the single-step "register and you're basically done" flow. All steps done, including two follow-up fixes from user testing. **Later change:** registration itself is now multipart (`POST /api/v1/vendors`) and requires PAN, phone, and the three mandatory documents (GST certificate, PAN card, incorporation certificate; bank proof optional) in the same request, saved in one transaction with the vendor row — enforced server-side, and the form's submit button stays disabled until they're attached. The vendor "My Documents" tab moved under a **My Profile** tab (sub-tabs: Company Details, My Documents); login still routes there with the missing-documents banner when applicable.

- **Explicit document prompt, not just a tab**: login/session-restore now checks the vendor's own documents (`GET /vendor-portal/documents`) and routes to My Documents with an explicit "please upload X, Y, Z" banner whenever a mandatory one is missing/unverified and the vendor isn't Active yet — previously the tab existed but nothing pointed a new vendor at it. The tab stays visible and usable afterward too (e.g. to replace an expiring license), this only changes the *default* landing view.
- **Reviewer must open a document before deciding on it**: Verify/Reject buttons in the staff review panel stay `disabled` (with a "View the document before deciding" hint) until that specific document has been opened via its View link at least once in the current review session — otherwise nothing stopped a reviewer from clicking through every document without ever reading one. Tracked client-side only (`reviewedDocIds`), resets when a different vendor's review is opened.
- **Post-approval Categories tab** (`frontend/js/pages/vendorCategoriesPage.js`'s `renderVendorCategoryPicker`): its own tab (`view-vendor-categories`), not embedded in the dashboard -- a real category checklist sourced from the live catalog (`GET /products`, same pattern as everywhere else), shown once the vendor is Active (a not-yet-Active vendor sees an explanatory message instead, since `POST /mappings` would 409 anyway). Checking categories and submitting calls the existing (unchanged) `POST /mappings` once per catalog entry in each selected category, using the vendor's own logged-in identity -- no backend changes needed, `POST /mappings` already accepted any `vendor_id`. Duplicate requests are reported as "already requested," not shown as failures. `routeVendorAfterAuth` sends a vendor here automatically the first time login/session-restore resolves to Active with an unvisited Categories tab (tracked client-side via `localStorage`, per vendor ID) -- afterward it's just another tab, freely revisitable to add more categories.
  - **New**: `GET /api/v1/vendor-portal/mappings` (vendor JWT) exposes a vendor's own mapping requests -- there was previously no way for a logged-in vendor to see their own request/approval status at all. The Categories tab uses it to split categories into **Approved** (read-only badges -- a Category Manager approved at least one product in that category, so it's locked; only staff can suspend/reinstate it from here on) and **Other** (checkboxes, showing a Pending/Rejected/Suspended badge where applicable, everything else still requestable). The dashboard notice now reflects the actual outcome ("Your category request(s): 1 approved, 1 rejected.") instead of always showing the same generic "go pick some" prompt once there's something to report.

- **Step 3 — staff-side document review** (`app/routers/vendors.py`): Category Manager now shares vendor-decision access with Procurement Admin (user-directed role change) — `VENDOR_DECISION_ROLES = (PROCUREMENT_ADMIN, CATEGORY_MANAGER, SYSTEM_ADMIN)` covers list/get/approve/reject/request-info *and* the new `GET/POST .../documents[/​{id}/verify|reject]` endpoints (also fixed a pre-existing gap: System Admin could list vendors but not decide on them). `request-info` now requires a `note` (mirrors `reject`'s required `reason`) — both are stored in the same `Vendor.rejection_reason` column, since either way it's "the explanation for the current non-Active status." **Hard approval gate**: `approve` 409s naming every mandatory document type that isn't Verified — there's no path to Active with a missing or unverified mandatory document. Rejecting a specific document never touches the vendor's own status by itself; the reviewer separately chooses Reject Registration or Request Documents Again once they've seen which document(s) failed. Frontend's Vendor Approval Queue gained a per-vendor review panel (replacing the old inline approve/reject/request-info row buttons) showing every document with Verify/Reject actions, a banner when a mandatory document is rejected, and the three vendor-level decision buttons.

- **Document upload** (`app/models/vendor.py`'s `VendorDocument`/`VendorDocType`/`DocumentStatus`, `app/services/document_store.py`, `app/routers/vendor_documents.py`): fixed KYC checklist (GST Certificate, PAN Card, Certificate of Incorporation — mandatory; Cancelled Cheque/Bank Proof — optional), one row per `(vendor, doc_type)` so re-uploading replaces the previous file and resets it to Pending rather than inheriting a stale verified/rejected status. Files are stored directly in Postgres (`LargeBinary`/BYTEA) rather than on disk or an object store — deliberate choice for this project's scale, kept behind `document_store.py`'s `validate()`/`scan()` so swapping the backing store later doesn't touch the router. "Analysis" is structural only per explicit scope decision: file type (PDF/JPG/PNG) and size (10MB cap) validation plus a malware-scan stub that does nothing — no OCR/content extraction. `GET/POST /api/v1/vendor-portal/documents` (vendor JWT), `GET .../{id}/download` (vendor JWT, must own it). **Not built yet**: the staff-side list/verify/reject endpoints and the hard gate on vendor approval (agreed: vendor can't be approved until every mandatory doc is Verified) — that's the next step.
- Frontend gained a Vendor Login tab and a vendor-only "My Dashboard" view (profile/status, tenders they're invited to with a Submit Bid action, and their own bid history) — a separate nav/session state from staff login, sharing the same JWT bearer mechanism but never interchangeable with it.

## Not yet built

Full Bidding (technical submissions, attachments, amend/withdraw, real price
confidentiality), evaluation, awards, PO export, the override engine, audit
log, notifications, background jobs (`IMPLEMENTATION-SPEC.md` phases 4–7);
Open Tender and Guest Invite within tendering (see Phase 3 notes above).
