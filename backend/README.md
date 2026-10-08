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

### MySQL (2026-10-08 port)

`DATABASE_URL` also accepts a MySQL instance:

```
DATABASE_URL=mysql+pymysql://user:password@host:3306/hospital_procurement?charset=utf8mb4
```

The existing 37 migrations are Postgres-specific history (enum `ALTER TYPE`
statements, the audit_log trigger written in PL/pgSQL, a couple of one-time
data-fix statements) and only replay cleanly against Postgres. For a
**fresh MySQL database**, skip `alembic upgrade head` and instead build the
schema straight from the current models, then sync Alembic's own bookkeeping
to match so every migration written *from this point on* still applies to
either dialect normally:

```bash
python -m app.init_db
python -m alembic stamp head
```

`app/init_db.py` also creates the audit_log immutability trigger for
whichever dialect it's run against. One real gap on MySQL: triggers never
fire on `TRUNCATE` there (it's DDL, not DML, unlike Postgres) — if that
guarantee needs to hold, revoke `DROP` on `audit_log` from the app's own DB
user at the GRANT level instead; `init_db.py` prints this reminder when it
runs against MySQL.

Going forward, new migrations should stay dialect-portable (no raw
Postgres-only SQL) so they keep applying to both Postgres and MySQL the same
way these don't.

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
see): Procurement Officer -> Tenders (creation, submission, resubmission, and later
L1 recommendation); Category Manager and Procurement Admin (one job) -> Vendors (KYC
review, suspend/blacklist/reinstate), Items catalog, Vendor Mapping, Vendor Rating
(incl. manual entry); Approving Authority -> E-Tender Approval only; System Admin ->
everything plus Staff accounts. Tender approval is Approving Authority only at every
value band (user-directed; spec section 11.2 had Procurement Admin approving up to Rs.1,00,000).
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

- **Vendor authentication** (`app/security.py`): a vendor sets a password at registration (`VendorCreate.password`, min 8 chars) and logs in with email + password (GSTIN, PAN, email and phone are each unique per vendor; email is lowercased, phone normalised to digits, PAN uppercased) at `POST /api/v1/vendor-auth/login`. Vendor JWTs carry `"typ": "vendor"` (staff tokens have none/`"staff"`), checked by both `get_current_user` and the new `get_current_vendor` dependency, so a vendor's token can never authorize a staff-only endpoint or vice versa. `GET /api/v1/vendor-auth/me` returns the vendor's own profile (including `rejection_reason` if rejected — a vendor should be able to see why). No password-reset flow exists yet (needs the Email/SMS adapter, not built).
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

## Catalog & mapping rework (Module 2 alignment)

Fixes found by re-reading spec §4 against the first build:

- **Categories are a table** (`product_categories`), not free text; a category has a procurement type and an optional minimum vendor rating for mapping. Endpoints: `GET/POST/PUT /api/v1/categories`.
- **Catalog core details** (all optional, ticked per entry in the form): unit of measure, regulatory class, approved brands, reorder level, unit price band, and a per-entry minimum mapping rating. `PUT /api/v1/products/{id}` edits an entry (type is fixed once created).
- **Type-specific attributes are validated per type** (`app/schemas/product_attrs.py`): Item, Asset, Service, plus the §4.2.2 software development/licensing fields on Service. Unknown keys are rejected.
- **Mapping is two separate levels** in the same table (`vendor_mappings`): item-level (`product_master_id`) or category-level (`category_id`), exactly one. Each is requested/approved/suspended on its own. Eligibility (`app/services/eligibility.py`): an approved category mapping covers the items in it (`CATEGORY_MAPPING_COVERS_ITEMS`), an approved item mapping adds to that, and a suspended/rejected item mapping excludes that vendor from that item.
- **Minimum-rating gate**: approving a mapping is refused (409) if the vendor's rating in that type is below the item's (else its category's) minimum.
- **Ratings are per (vendor, procurement type)**: `GET /ratings?procurement_type=`, `GET /ratings/{vendor_id}?procurement_type=`, `PATCH /ratings/{vendor_id}` (type in body). Eligibility uses the rating of the line item's own type. Existing single ratings were copied to all three types by the migration.
- **Security fix**: `POST /mappings` is now staff-only; vendors request their own via `POST /vendor-portal/mappings` (vendor id comes from the login, never the body).
- Not built yet: supporting-credential attachments on mapping requests (§4.3 point 1).

## Partial publish, mapping dialog, Modernist UI (2026-09-24)

- **Partial publish**: a tender line with no eligible vendor no longer blocks the tender. Submit/approve only refuse if *no* line has an eligible vendor. On approval each line gets `published` = has invites; held lines are listed on the tender screen and can be published later with `POST /api/v1/tenders/{id}/line-items/{line_id}/publish` (re-resolves eligibility; still-zero returns 409). Reverting to Draft clears all `published` flags. A held line's value is still counted in the approval tier.
- **Mapping matrix**: clicking a cell opens a detail dialog (facts, scope, versioned history) — the only place approve/reject/suspend/reinstate/map happen.
- **UI**: restyled to the Modernist design system from the reference prototype (left sidebar shell, Archivo, accent #ec3013, radius 0). See `DESIGN-REFERENCE.md`.
- **Guest vendors**: the user directed (2026-09-24) that Guest Invite follow the prototype (guest may bid; PO blocked until KYC). Not built yet; see the update at the top of the PROJECT OVERRIDE section in `CLAUDE.md` and its "Active Questions".

## Vendor suspend / reinstate / blacklist (spec 3.4)

- `POST /api/v1/vendors/{id}/suspend` (Active only, reason required), `/reinstate` (Suspended, or Blacklisted with a mandatory reason), `/blacklist` (Active or Suspended, reason required), `GET /{id}/status-history`. Roles: Procurement Admin, Category Manager, System Admin.
- Every status change (registration, approve, reject, request-info, suspend, reinstate, blacklist) goes through `services/vendor_status.set_status` and is written to `vendor_status_history`.
- Suspended: can log in and view, but can't bid (bid gate and `can_bid`), be mapped or be invited; mappings and history are kept. Blacklisted: can't log in (403). It is reversible by Procurement Admin / Category Manager / System Admin via `POST /{id}/reinstate` with an **explicit, mandatory reason** recorded in `vendor_status_history` (no approval step). The Procurement Officer has no access to vendor endpoints.
- Not built yet: document expiry dates and auto-suspend on expiry (spec 3.5) — the next Module 1 item.

## Document expiry (spec 3.5)

- `vendor_documents.valid_till` (optional per document; set by the vendor at registration or upload). `expiry_state` = none / ok / expiring (within `EXPIRY_WARNING_DAYS`, 30) / expired, returned on every document response.
- `services/expiry.py`: an Active vendor with an expired (non-rejected) document is **auto-suspended** ("Auto-suspended: <doc> expired on <date>", logged in `vendor_status_history`). Runs at startup and then daily (`main.py`; expiry is a date, so daily is enough), and directly at bid submission; tender eligibility also excludes any vendor with an expired document.
- When the vendor uploads a renewed document (it goes back to Pending) and staff **verify** it, a vendor suspended *by expiry* is auto-reinstated once no expired document remains. Manual suspensions are never lifted automatically.
- Dashboard shows expiring/expired document counts as alerts. Which document types actually carry expiry (licences, ISO, MSME) arrives with the missing registration document types.

## Registration fields & document types (spec 3.2)

- Vendors now carry every §3.2 field group: trade name, entity type, year of incorporation, registered address, branch locations; bank name / account number / IFSC; contact designation and escalation contact; optional payment terms, lead time and minimum order value. Columns are nullable only for vendors registered before this change; registration requires the mandatory ones and validates GSTIN, PAN and IFSC formats (spec 3.3 step 2).
- New document types: business licence, drug licence, MSME/Udyam, ISO/quality certificate (all carry optional expiry dates) and a sample product catalogue / price list (PDF, image, or XLSX/CSV).
- **Mandatory documents** are now GST certificate, PAN card, certificate of incorporation, cancelled cheque / bank letter, and sample catalogue. The licences and ISO certificate are optional ("Yes (as applicable)" in the spec). Vendors registered earlier are unaffected; the mandatory set only gates approving pending vendors.
- Bank account numbers are stored as plain text (no encryption/masking yet).

## Required vendor documents per product / category (user-directed)

- `product_master.required_documents` and `product_categories.required_documents` (lists of `VendorDocType` values) are set when a catalog entry / category is created or edited (a "Documents required from a vendor" row in the core details, and checkboxes on the category form).
- A vendor's own mapping request (`POST /vendor-portal/mappings`) is refused (409) until every required document is uploaded (not rejected, not expired) — an item needs its own plus its category's, a category needs the category's. The vendor's Request panel shows what's required and disables the option until the upload exists.
- Approving a mapping (`POST /mappings/{id}/approve`) requires each required document to be **Verified** and unexpired; the staff mapping dialog lists them with the vendor's status. Auto-closing pending item requests when a category is approved also respects this, and a vendor covered only through a category is still excluded from an item whose own required documents aren't verified.
- This also delivers spec §4.3 point 1 (supporting credentials with a mapping request), driven by the catalog configuration.

**"Other" required documents:** besides the standard document types, a catalog entry/category can require a free-text document (stored as `other:<name>` in `required_documents`, e.g. "CE marking certificate"). The vendor uploads a file for it (`doc_type=other` + `custom_label`, matched to the requirement case-insensitively; one row per vendor per label — the unique constraint is now `(vendor, doc_type, custom_label)`), and the human reviewer reads the name and verifies it like any other document. The same upload → verify gates apply to mapping requests and approvals.

## Staff accounts (admin panel)

`/api/v1/staff` (System Admin only): list, create, edit (name/role/facility/approval tier),
reset password, deactivate/reactivate. Rules: email is unique and fixed once created;
an Approving Authority needs an approval tier (other roles have it cleared); you can't
deactivate or change the role of your own account; at least one active System Admin must
remain. The admin sets the initial password and shares it directly (no email adapter yet;
no forced change-on-first-login). Accounts are deactivated, never deleted, so past work
keeps its author. UI: "Staff accounts" tab (`frontend/js/pages/staff/`).

## Audit log (spec §12.6 / §14)

One insert-only `audit_log` table. A database trigger rejects UPDATE, DELETE and TRUNCATE
(so no application code path can change history); each row copies the actor's name and role
at write time. Rows are written by `app/services/audit.py`'s `record()` from inside the
service/router that makes the change, in the same transaction, so a rolled-back change leaves
no audit row. Never recorded, whatever a caller passes: passwords, GSTIN/PAN/bank details/phones
(masked elsewhere too) and bid prices (sealed until the deadline, spec §9.6).

Recorded: vendor registration/status changes/document upload-verify-reject-view/sensitive-field
reveals (and failed reveal attempts); mapping requested/approved/rejected/suspended/reinstated;
catalog category and item create/update/(de)activate; manual rating entries; staff account
create/update/deactivate/reactivate/password reset; tender create/update/line items/submit/
approve/reject/withdraw/line publish, plus the eligibility computation at submission and approval
(spec §6.5); bid submitted (no price); staff and vendor logins, failed and blocked logins.
The pre-existing history tables (vendor status, mapping, rating, approval rounds) were copied in
once by the migration, marked `imported`; the per-area history tables still drive their own screens.

API (System Admin only, read-only): `GET /api/v1/audit-log` (filters: entity_type, entity_id,
action, actor_type, actor_id, facility_id, date_from, date_to, search; paginated),
`GET /audit-log/filters`, `GET /audit-log/export` (CSV). UI: "Audit log" tab
(`frontend/js/pages/audit/`). Not yet audited: reading the log itself, and things not built yet
(L1 selection/approval, PO export, override engine, notifications) -- add a `record()` call when
each is built.

## Bid submission form (spec §8)

Vendor endpoints under `/api/v1/vendor-portal/bids` (`app/routers/vendor_bids.py`, rules in
`app/services/bids.py`): `GET /line/{line_item_id}` (the form: line context, what this line
requires, the vendor's own bid), `PUT /line/{line_item_id}` (save a draft, submit, or amend a
submitted bid), `POST /{id}/withdraw`, `POST|DELETE /{id}/attachments`, `GET /{id}/attachments/{aid}/download`,
`GET ""` (own bids). Bid statuses: draft -> submitted <-> withdrawn (a withdrawn bid reopens as a draft).

Fields: unit price, GST %, other duties per unit, delivery lead time (days), quote validity (days),
payment terms (optional), technical compliance statement (required for RFP tenders and technically
scored lines), brand offered, plus type answers: Item shelf life at delivery (when the catalog item is
batch/expiry tracked); Asset warranty months (required), installation/training included, spares
commitment years, "bidding as a distributor"; Service SOW/method statement (required), manpower plan,
SLA commitment. Landed price = unit price + GST + duties (what evaluation will rank on).

Attachments (PDF, DOCX, XLSX, JPG, PNG; 10 MB; scanned via the document-store stub), mandatory by
type: Asset -> datasheet (+ manufacturer authorization if distributor); Service -> SOW/method
statement (+ manpower plan where the catalog item has manpower norms; datasheet on RFP); Item -> none,
except a datasheet when the tender is RFP / the line is technically scored.

Server-side gates on every change: vendor Active (expiry sweep first), tender Published AND the line
published, before the deadline, vendor individually invited. A submit or amendment that leaves a
required field or mandatory attachment missing is refused with the exact list. A vendor can only ever
read their own bid; staff have no bid-read endpoint yet (Evaluation phase), so prices stay sealed.
Audit rows (draft/submit/amend/withdraw/reopen/attachment) record field names only, never values.

Not built yet: bid-level (whole-tender) attachments, late-submission exception, due-date extension,
per-line all-or-nothing tenders, the staff comparison view and price unlock (Evaluation).

## Bid tracking & technical evaluation (spec §9.2, §9.6)

Staff endpoints under `/api/v1/evaluation` (`app/routers/evaluation.py`, rules in
`app/services/technical_evaluation.py`). Viewers: Procurement Officer, Category Manager, Procurement
Admin, System Admin; scoring: Category Manager / Procurement Admin / System Admin.

- `GET /lines`, `GET /lines/{id}`: every published line and its stage (bidding open -> technical
  evaluation -> technical closed). **Before the due date only Submitted / Not submitted per invited
  vendor is shown** (a vendor's drafts stay private). After it, the **technical envelope only**: brand,
  compliance statement, type answers (shelf life, warranty...), attachment list. Unit price, taxes,
  lead time, validity and payment terms are never in any response here.
- `PUT /bids/{id}/evaluation`: an evaluator's qualify/disqualify (reason required to disqualify) or,
  on technically scored lines (scored / QCBS), 0-100 scores per criterion. Weights (spec 9.2.2,
  illustrative, normalised over the criteria that apply): compliance 35, vendor rating 15 (automatic,
  from Module 3), warranty/serviceability 20 (Asset), manufacturer authorization 10 (Asset), SOW/SLA
  quality 20 and manpower 15 (Service), past performance 15 (optional). Minimum qualifying score 60.
  Evaluators score independently: until the line is closed each sees only their own.
- `POST /lines/{id}/close-technical`: needs every submitted bid evaluated; records qualified /
  disqualified per bid (any evaluator's disqualification disqualifies; scored lines average the
  evaluators and need the minimum), T-ranks qualified bids on scored lines (tie-break: higher rating,
  then earlier submission) and locks the line. Only qualified bids may have prices opened later.
- `GET /bids/{id}/attachments/{aid}/download`: evaluators only, after the due date, every view logged
  (`bid.attachment_viewed`, spec 8.3.3).
UI: "Bid evaluation" tab (`frontend/js/pages/evaluation/`). Audit: `evaluation.saved`,
`evaluation.technical_closed`, `bid.attachment_viewed`.

Not built: commercial price unlock and L-ranking / QCBS (next), per-line minimum score and evaluator
designation per category, exclude-outlier averaging, governed override for changing a score after close.

## Commercial evaluation (spec §9.3, §9.4)

`GET /api/v1/evaluation/lines/{id}/commercial` -- the comparative statement. **Automatic, not a manual
step:** it opens as soon as the line's technical evaluation is closed (409 before that; 409 before the
due date). Visible to the Procurement Officer and System Admin only (Category Manager, Procurement Admin
and Approving Authority get 403; the Approving Authority sees prices at L1 approval, not built yet).
Every opening is audited (`evaluation.prices_viewed`).

Only technically qualified bids are ranked; a disqualified bid is listed with its reason and **no price
fields** (never opened, spec 9.2.4). Standard and scored lines: ranked by landed price (unit price + GST +
other duties), L1 = lowest; tie-break: higher current rating, then higher technical score, then earliest
submission (flagged on the row). QCBS lines: price score = lowest landed / this landed x 100, combined =
technical score x technical weight + price score x price weight (weights taken from the line, e.g. 70/30),
ranked C1, C2, highest first. Rows also show variance against the internal estimated price and flag prices
outside the catalog price band or far from the estimate. The statement recommends rank 1 but awards
nothing: the Officer's L1 confirmation, split-award proposal and non-top-ranked override come next.

### Technical evaluation, revised (user-directed)

- **Every line is scored out of 10**, standard or technically scored, on the spec 9.2.2 aspects (compliance,
  vendor rating (automatic), warranty/serviceability and manufacturer authorization on Assets, SOW/SLA and
  manpower on Services, past performance optional). Weighted average out of 10; a bid qualifies at 6.0 or more,
  or is disqualified outright by the evaluator with a reason. Only scored / QCBS lines then get T1, T2...; on
  standard lines qualified bids stand on equal footing. (QCBS multiplies the technical score by 10 to combine
  it on a 100-point scale with the price score.)
- **The bid's content is not in the table.** `GET /evaluation/bids/{id}/review` (evaluators only, after the
  due date) returns the technical envelope when an evaluator clicks Evaluate. The Procurement Officer gets
  403 there, sees no bid content and no scoring, only the recorded outcome once a line is closed.
- **Files must be opened first.** Each attachment download by an evaluator is recorded
  (`bid_attachment_views`); `PUT /bids/{id}/evaluation` returns 409 until that evaluator has opened every
  attachment on the bid (a second evaluator must open them too). The pop-up mirrors this.

### Corrections (latest)

- **Technical scores are on the spec's 100-point scale again** (spec 9.2.5: minimum qualifying score "e.g. 60/100"; QCBS
  combines technical and price percentages). Criteria are scored 0-100, the vendor's Module 3 rating is used as-is for its
  automatic criterion, the minimum is 60, and QCBS combines the two 100-point scores by weight. Supersedes the "out of 10"
  text above.
- **Evaluation comments** are "Comments (if any)"; only when Disqualify is ticked and the box is empty is a reason required
  (the box is highlighted on submit; the server also refuses).
- **Approval review** `GET /api/v1/tenders/{id}/approval-review` (read-only): header terms, facility, department, dates,
  total estimated value and the tier it needs, each line (type, quantity, estimated price, evaluation method, split-award,
  specification and catalog attributes, required vendor documents) with the vendors it would be published to (live
  resolution) or a "held back" flag, warnings, approval history, and whether the viewer may decide. The Approving Authority
  decides from inside this review; approval accepts optional comments, rejection requires them.
- **Minimum vendor rating**: an item's own minimum overrides its category's. The approval error now says where the number
  comes from, and editing a category's minimum offers to make items that set their own follow the category
  (`apply_minimum_to_items`, audited per item).

## L1 recommendation, L1 approval, PO data files, vendor notification (spec §9.5, §10)

**Officer (L1 confirmation, `/api/v1/awards`).** After a line's technical evaluation is closed, the Officer recommends per line
(`PUT /awards/lines/{id}/recommendation`): `confirm_top` (the system's L1/C1), `other_vendor` (a different technically qualified
bid; **a reason is mandatory**), `split` (Split-Award lines only: shares total 100%, each at least `MIN_SPLIT_PCT`=10%, qualified
bids only), or `exclude` (leave the line out of the award; reason mandatory). Saved as a draft; `POST /awards/tenders/{id}/submit`
sends every line to L1 approval. The required tier comes from the total award value (landed price x allocated quantity) via the
value bands, one tier higher if a line has been rejected 3 times running.

**Approving Authority (L1 approval).** `POST /awards/lines/{id}/decision`: `approve` (the Officer's recommendation; a split's shares
can be adjusted), `award_system_l1` (only when the Officer chose someone else), or `reject` (comments mandatory; the line comes
back to the Officer as the next round). Each line keeps its own round history (`award_rounds`, `award_allocations`). Prices are
shown to the Officer and to the Authority only once a recommendation is submitted; Category Manager / Procurement Admin get 403.
When every published line is approved (or left out) the tender becomes **Awarded**.

**PO data files (`/api/v1/po-files`).** On the last approval the system generates **one file per awarded vendor**, consolidating
that vendor's lines and shares, from the approved allocations only (`po_data_files.payload` is a frozen snapshot; CSV and XML are
rendered from it on download, `?format=csv|xml`). Fields per spec 10.4: batch id, tender reference, facility/entity code,
department, vendor code + GSTIN, item code, description, quantity, UOM, unit price, tax, line total, delivery lead time and
location, payment terms, approver id/name/timestamp (budget code blank until the ERP template is known). Handoff is manual
(user-directed): Procurement Admin / Category Manager downloads the file as CSV or XML and hands it to the ERP team. Recording the
ERP's import outcome (`mark-imported`/`mark-failed`) and re-exporting a corrected file (spec 10.5 points 3-5, 10.7) were built and
then **removed as out of scope for now** (user-directed, 2026-09-28) -- this app's responsibility ends at the generated file. The
`PoDataFile` columns that supported that (`status` beyond `pending_upload`, `erp_po_number`, `status_reason`, `status_changed_*`,
`supersedes_id`) and the `PO_REEXPORT` override type's config row are left in place, unused, for when this comes back; the
`po_files.re_export()` service function and the `/po-files/{id}/mark-imported|mark-failed|re-export...` endpoints are gone. The
Officer and Authority can list files but not download them (they carry GSTIN and prices).

The dashboard's "Upload PO data file" action-queue task and `badge-pofiles` used to clear once a file was `mark-imported`/
`mark-failed`; with that gone a file's `status` can never leave `pending_upload`, so the task would nag forever regardless of
whether anyone had handled the file. Removed entirely (user-directed, 2026-09-28), same as the buttons that used to clear it:
`DashboardStatsOut.po_files_pending`/`DashboardPoFileOut` (`schemas/dashboard.py`), the query building it (`dashboard.py`), the
`badge-pofiles` element and its `nav.js` update, and the dashboard task line are all gone. The PO data files tab itself is
unaffected -- staff still open it directly to download files, there's just no more "pending" nudge pointing at it.

**Vendors are told at L1 approval** (user-directed, spec 10.6): awarded vendors (lines, quantities, prices), technically qualified
vendors who did not win (regret), and technically disqualified vendors (sent when technical evaluation closes). Delivery is a
portal notification (`/vendor-portal/notifications`); there is no email/SMS gateway, so that is logged, not sent. Vendors also see
an Outcome per bid (Awarded (qty) / Not selected / Technically disqualified).

Audit: `award.recommendation_saved`, `award.submitted_for_l1_approval`, `award.approved`, `award.rejected`, `award.finalized`,
`award.prices_viewed`, `po_file.downloaded`.
Not built: per-line configurable minimum split, SLA-based escalation, ERP API/SFTP push and return channel, guest-vendor PO block.
PO import-outcome tracking and re-export were built then descoped -- see "PO data files" above.

## Tender header/line fields exposed in the UI (spec §6.2-6.3.4, user-directed 2026-09-28)

Backend fields that already existed but had no form control are now on the tender editor:
- **Header:** Publish Date, Minimum vendors to invite, Maximum vendors to invite, and a new
  **Terms & Conditions** free-text field (`Tender.terms_and_conditions`, migration `a3e6f0c2d9b4`) --
  spec §6.2 names all four but none had a UI field before this. The E-Tender Approval review screen
  shows Terms & Conditions and now warns (not blocks -- spec never describes Minimum's enforcement,
  unlike Maximum's, §6.5 point 5) when a line's eligible-vendor count is below the configured minimum.
- **Line item — new "Evaluation & award" row:** Technical evaluation method (Qualify/Disqualify /
  Scored / QCBS, defaulted by procurement type per §9.2.1, editable), QCBS technical/price weights
  (defaulted to the spec's 70/30 Asset / 60/40 Service starting points, §9.4), Split-Award allowed
  (§6.3.4), and a per-line minimum rating threshold override (§6.3.4). These map onto
  `TenderLineItem` columns that already drove Split-Award, QCBS and per-line-threshold behavior end
  to end (evaluation, ranking, L1 award) but were previously only reachable by calling the API
  directly -- there was no way for a real Procurement Officer to set any of them.
- `LineItemCreate` now rejects a QCBS line with no positive technical/price weight at save time
  (previously only failed later, at commercial-evaluation time, after bids had already closed).

## Type-specific tender line-item fields (spec §6.3.1-6.3.3, 2026-09-28)

The rest of §6.3's per-type line fields -- previously real backend data (`TenderLineItem.line_details`,
an untyped JSON bag) with no UI to fill it -- are now on the tender editor, following the plan already
agreed in `GAPS.md`: mirror the catalog's `type_specific_attrs` / `ATTRS_BY_TYPE` pattern exactly rather
than hand-building each field.

`app/schemas/line_details.py` defines `ItemLineDetails` / `AssetLineDetails` / `ServiceLineDetails`
(all fields optional, `extra="forbid"` so an Item line can't carry Service-only keys) and
`LINE_DETAILS_BY_TYPE`, the same shape as `app/schemas/product_attrs.py`. `LineItemCreate` gained a
`clean_line_details()` model validator (mirrors `ProductCreate.check_rules()`) that validates
`line_details` against the line's own type and drops anything unset -- `mode="json"` on the dump so a
`date` field validates to an ISO string, not a raw `date` object the JSON column can't serialize.

Frontend: `frontend/js/pages/tenders/lineDetailFields.js` holds the three field-description lists
(same `{name, label, kind, showWhen}` shape the catalog forms already use), rendered by
`tenderLineItems.js` through the catalog's own generic kit (`fieldHtml`/`readFields`/
`wireConditionalFields` from `js/pages/catalog/formKit.js`, reused across modules rather than
reimplemented) -- which gained one new field `kind`, `date`, for this. Since typing into these fields
doesn't drive any other live UI (unlike quantity/price, which update the visible budget), they're read
straight from the DOM at save time rather than synced into the row's JS state on every keystroke; the
one place that still needed an explicit flush is changing a line's technical evaluation method, which
re-renders the whole panel and would otherwise discard whatever was already typed. Changing the line's
catalog entry instead resets its `line_details` to empty, since a different item/asset/service's
specifics don't carry over.

`delivery_date`/`delivery_location` are the same field names on both Item and Asset (spec calls them
"delivery date/location" and "delivery/installation date & location" respectively, same concept) --
`app/services/po_files.py` already read `line_details["delivery_location"]` for the PO data file's
"Delivery / Service Terms" field and got `None` every time, since nothing ever wrote it; it now
resolves for real once a line has this filled in. The E-Tender Approval review screen already rendered
arbitrary `line_details` keys generically (`js/pages/approvals/reviewPanel.js`'s `kv()` helper), so no
review-screen change was needed for these to show up there.

**Deliberate simplification:** spec §6.3.3's "License / IP Terms (Software lines)" bullet
(license type/tenure, seats/usage tier, source-code escrow, IP assignment, data residency) largely
repeats the catalog's own per-product software sub-schema (`ServiceAttrs` in `product_attrs.py`).
Re-modeling all of that again per tender line for marginal benefit wasn't proportionate, so it's
collapsed into one `license_ip_terms_notes` free-text field -- this tender's own adjustments on top of
the master record, the same "master spec + line-specific notes" shape as Item's
`technical_spec_override`.

Verified end-to-end via API: all three types' fields round-trip through create -> line-item read ->
approval review correctly; an unknown or wrong-type key is rejected with 422
(`extra_forbidden`). **Not verified visually in a browser** -- no browser-automation tool was available
this session; the frontend changes were JS-syntax-checked (`node --check`) and reviewed by hand against
the existing, already-proven catalog-form pattern they reuse.

See `GAPS.md` for the fuller list this was pulled from and what's still open (the rest of the
type-specific line fields, §6.3.1-6.3.3, are next -- planned as a generic per-type schema mirroring
`app/schemas/product_attrs.py`'s existing pattern, not yet built).

## Evaluation method locked after first publish (spec §9.4, tightened 2026-09-28)

Spec §9.4: a line's technical evaluation method (and its QCBS weights / Split-Award flag) is "fixed
per line item at tender creation... cannot change after publish without a governed override -- vendors
always know upfront how they'll be evaluated." This was previously unenforced: since a Published
tender with zero bids can be reverted to Draft (`withdraw-to-draft`, allowed when nothing has been
protected yet) and freely re-edited, an Officer could revert, change a line's evaluation method,
and republish -- exactly what §9.4 says shouldn't happen once vendors were told upfront.

`app/routers/tenders.py`'s `_check_evaluation_lock()` now blocks that: once a tender has been
**approved at least once** (checked against the permanent `tender_approval_rounds` history, not
`Tender.published_at`, since `withdraw-to-draft` clears that field on every revert), a Draft-edit
that changes `technical_eval_method`, `technical_weight`, `price_weight` or `split_award_allowed` on
a line that already existed at that approval is refused (409), matched by catalog entry since line
items have no stable id across saves. Unrelated edits (quantity, price, adding a brand-new line) are
unaffected; a tender that was never approved stays freely editable. There's no governed-override path
to lift this yet (spec §12's engine isn't built, see `GAPS.md`), so for now it's a hard block, not an
override queue.

## Price Competitiveness — real computation (spec §5.1-§5.3)

Vendor rating has five sub-scores (spec §5.2); four are manual entry, and Price Competitiveness was
the one meant to be system-computed from this system's own bid history -- until now it was permanently
hardcoded to 50.0, since no staff-facing bid-read endpoint existed yet to derive it from.

It now computes for real, triggered the first moment prices are legitimately comparable: when a
line's technical evaluation is closed (`close_technical_evaluation()` in `app/routers/evaluation.py`).
For every bid marked technically Qualified on that line (Disqualified bids are excluded -- they never
reach commercial ranking either), the landed price (`unit_price * (1 + gst_percent/100) + other_duties`,
same helper `commercial.landed_unit_price()` used for the L1 price comparison) is compared against the
line's lowest landed price using the same 0-100 formula as commercial L-ranking (spec §9.4):
`price_score = lowest_landed_price / this_bid_landed_price * 100`. Reusing that exact formula keeps
Price Competitiveness internally consistent with how L1 commercial ranking already scores the same
bids.

Each qualified bid's score is written once to a new `price_competitiveness_records` table
(`app/models/vendor_rating.py`; one row per bid, never updated -- a bid's price and line don't change
after the fact, and a line can't be re-closed). `refresh_price_competitiveness()`
(`app/services/ratings.py`) then averages a vendor's records over a rolling 12-month window (spec §5.3:
"so old bid history ages out") into `vendor_ratings.price_competitiveness`, and folds it into the
overall score the same way the four manual sub-scores already do.

A line with fewer than 2 technically-qualified bids computes nothing -- there's no competing price to
score against, so the vendor's existing score (or the provisional default) is left alone rather than
recording a meaningless 100. The update is audited as `rating.price_competitiveness_updated`
(actor=None/system, since this runs automatically off the close-technical action, not a direct user
request) naming the affected vendors.

Not built: a floor/staleness flag when a vendor has zero records ever (spec §5.3 point 5 covers the
manual sub-scores' "Stale -- Manual Update Due" state; Price Competitiveness instead just keeps the
50.0 provisional default indefinitely until the first qualifying line closes).

## Manual Override & Exception Approval Workflow Engine (spec §12) -- engine only, not wired yet

Spec §12.1/§12.2: every manual override anywhere in this app (rating override, invite-list add, guest
invite, technical score correction, late-submission exception, due-date extension, non-L1/C1 award
override, PO re-export) is supposed to run through **one** common, configurable approval workflow
rather than bespoke logic per module, and none of them takes effect on the record it modifies until
that workflow reaches Approved. Until now none of this existed -- the handful of places that already
anticipated it (e.g. `evaluation.py`'s technical-evaluation-lock message, `ratings.py`'s comment on why
Price Competitiveness isn't in the manual-update endpoint, `po_files.py`'s re-export) just said so in a
comment and hard-blocked or let the action through unconditionally instead.

This pass builds the generic engine end-to-end and proves it works, but deliberately does not wire it
into any of the 8 override types yet (user-directed 2026-09-28) -- see "What's not done" below.

**Model** (`app/models/override.py`):
- `OverrideType` -- the 8 types spec §12.3 names.
- `OverrideTypeConfig` -- one configurable row per type: default approver role (+ tier, for
  Approving Authority -- see below), whether that default is self-attested, the escalate-to role (+
  tier), an optional escalation value/count threshold, and an SLA window in hours. Seeded in
  `app/seed.py` with spec §12.3's own illustrative values (still to be finalized against the
  hospital's real delegation-of-authority policy, same as `ApprovalBand` -- CLAUDE.md open question 2
  names §12.3 explicitly). "Department Head" and "Finance/Management Committee" aren't separate roles
  in this system (`user_account.py`'s Role enum has just one Approving Authority role); they map onto
  `APPROVING_AUTHORITY` at tiers 2 and 3, the same tiers `DEFAULT_APPROVAL_BANDS` already uses for
  E-Tender/L1 approval, so the two configurable matrices agree with each other.
- `OverrideRequest` -- one workflow instance. `entity_type`/`entity_id` point at whatever record the
  override concerns (a `VendorRating`, a `BidTechnicalResult`, a `PoDataFile`...) without an FK -- the
  same polymorphic-reference pattern `AuditLog` already uses, so this is one table for every override
  type rather than one per module. `proposed_change` is a free-form JSON before/after for
  record-keeping/display only in this pass (see "What's not done").

**Service** (`app/services/overrides.py`) implements spec §12.4's state machine:
- `create_override()` -- validates a mandatory reason code + justification (§12.4 step 1), resolves
  the required approver (§12.5: type → value/count band, where an optional `trigger_value` crosses
  the configured `escalation_threshold` → resolves straight to the escalate-to role instead of the
  default one, rather than starting low and escalating after the fact), and either lands in Pending
  Approval or, for a self-attested type requested by someone who already holds the default approver's
  own role/tier, auto-approves immediately -- still recorded as its own distinct Approved step (§12.5:
  "auto-approved within that authority, not skipped"), not silently bypassed.
- `approve_override()` / `reject_override()` -- gated by `_can_decide()` (same shape as
  `approval_matrix.py`'s `can_approve_tier`: System Admin is a catch-all, otherwise the decider must
  hold the currently-resolved role at least at the currently-resolved tier); rejection requires a
  reason (§12.4 step 4), approval doesn't touch the target record (§12.1 -- see "What's not done").
- `escalate_override()` -- manual escalation to the configured next role (§12.4 step 5's "value/count
  crosses a trigger" side, exercised by a human since no override type is wired to real business data
  yet to trigger it automatically); this engine models one escalation tier per type (matching spec
  §12.3's table, which never lists more than one "Escalates To" per type), so an already-escalated
  request can't be escalated again.
- `_apply_sla()` -- the other half of step 5 plus step 6 (Expired): lazily evaluated whenever an
  override is read or listed, since this app has no scheduler/cron. A request left past its
  `sla_due_at` auto-escalates once if there's somewhere to escalate to, or auto-expires (logged,
  discarded) if there isn't or it's already been escalated.
- Every transition is written to the existing audit log (`override.requested/.approved/.rejected/
  .escalated/.expired`), not a separate log -- spec §12.6 says the override trail "feeds the same
  audit log referenced under Auditability."

**API** (`app/routers/overrides.py`, `/api/v1/overrides`): `POST` to request (any authenticated staff
role -- which roles typically request which type is left to whichever module eventually wires a type
in, not hardcoded in this generic engine, per CLAUDE.md "one reusable... engine, not bespoke logic per
module"), `GET`/`GET /{id}` to list/inspect (filterable by status/type), `POST /{id}/approve`,
`/reject`, `/escalate`. No module's own screens surface these yet, so this endpoint is currently the
only way to see one.

Verified end-to-end (temp script, cleaned up after): ordinary request → role-gated approve; rejection
without a reason blocked; a self-attested guest-invite request auto-approving under the requester's
own authority; a large `trigger_value` resolving a late-submission-exception request straight to the
escalated tier at creation time; manual escalation, blocking a second escalation, and the escalated
tier's approver (but not a lower tier) being able to decide it; System Admin approving regardless of
the resolved role; validation on blank reason code/justification; and every transition landing in the
audit log.

**What's not done (deliberate, this pass):** no staff-facing "My Overrides" / "Pending My Approval"
screen (the dashboard isn't touched by this pass); the SLA sweep is lazy (evaluated on read), not a
background job, consistent with how this app has no scheduler anywhere else either.

## Wiring the 3 override types that already had a target record (spec §12, follow-up pass)

Three of the 8 override types already had a real feature to hook into -- each had previously either
hard-blocked with a "this needs the override engine" comment, or (PO re-export) run unconditionally
with a comment saying it should be gated. All three now actually apply their effect on Approved rather
than completing an inert workflow:

- **Price Competitiveness override (spec §5.3.1 point 4)** -- `POST
  /ratings/{vendor_id}/price-competitiveness-override` (Category Manager / Procurement Admin) creates
  the request with `trigger_value = abs(new_score - current_score)`, which spec §12.3's seeded 15-point
  band can route straight to the escalated tier for a large adjustment. `POST
  /ratings/price-competitiveness-overrides/{id}/approve` (`ratings.py`) sets
  `vendor_ratings.price_competitiveness` to the proposed value, recomputes the overall score, and adds
  a `RatingHistory` row -- same trail the four routine manual fields already get, just via the governed
  path instead of `update_rating()`.
- ~~**PO data file re-export (spec §10.5 point 5 / §10.7)**~~ -- was wired this pass (`POST
  /po-files/{po_id}/re-export` requested the override; `.../approve` performed the actual re-export).
  **Removed 2026-09-28** (user-directed, out of scope for now) along with `mark-imported`/`mark-failed`
  entirely -- see "PO data files" earlier in this file. `OverrideType.PO_REEXPORT`'s config row is still
  seeded (generic engine data, same as the 5 types that were never wired), it just has nothing to hook
  into right now.
- **Technical evaluation score correction (spec §9.2.4)** -- `PUT
  /evaluation/bids/{bid_id}/evaluation-correction` is the governed path `save_evaluation()`'s 409
  ("a change now is a governed override") already pointed to. It dry-runs the proposed correction in
  memory (this app's session has autoflush off, so nothing is written) through a new
  `technical_evaluation.consolidate_line()` -- refactored out of `close_technical()` so both share one
  consolidation implementation -- to check spec §12.3's literal trigger: does the correction change any
  bid's recorded outcome or T-rank on the line. If so it escalates immediately, no numeric band needed
  for a pass/fail condition. `POST /evaluation/evaluation-corrections/{id}/approve` applies the
  corrected `BidEvaluation`, re-consolidates the whole line, and updates every bid's existing
  `BidTechnicalResult` row in place (ranks are relative across the line, so one bid's correction can
  reorder others). Because the qualified set and/or relative pricing may have changed, it also deletes
  and recomputes this line's `PriceCompetitivenessRecord` rows from scratch and refreshes
  `vendor_ratings.price_competitiveness` for every vendor who had a record before OR after the
  correction (not just the new set -- a vendor dropped from "qualified" needs their average
  recalculated without the now-deleted record too, not left stale).
  **Guardrail:** only usable before the line's L1 recommendation has started (an `AwardRound` row
  already existing for the line means the Officer has begun acting on the current outcome; correcting
  under that isn't supported and is refused with a 409) -- deliberately narrower than "any time before
  award," since the spec doesn't address what a mid-recommendation correction should do to an
  in-progress `AwardRound`.

Verified end-to-end (temp script, cleaned up + ratings restored to baseline after): all three requests
create and resolve correctly; the rating override applies and appears in rating history; the PO
re-export approval actually produces a new file version and marks the old one superseded; the
technical correction auto-escalates on a qualification flip, applies the flip to
`bid_technical_results`, empties this line's now-under-2-qualified price-competitiveness records, and
correctly resets both affected vendors' `price_competitiveness` back to their prior value.

**Still not done:** Non-L1/Non-C1 award override (a different, already-shipped direct-decision flow --
see below) and the remaining 4 types that need a feature built first (guest invite, invite-list add,
late-submission exception, due-date extension) -- tracked in `GAPS.md`.

**Non-L1/Non-C1 award override remains a special case, not just unwired.** L1 Approval already lets
the Approving Authority pick the Officer's recommended alternate over the system's L1 as a direct,
one-step decision with a mandatory reason -- built and tested before this engine existed. Routing that
through here instead would change an already-shipped flow's behavior, not just add a hook, so it's
flagged in `GAPS.md` rather than done silently.

## Qualify/Disqualify is a genuine toggle again, not a hidden numeric score (spec §9.2.1, reverted 2026-09-28)

Spec §9.2.1 describes Qualify/Disqualify as "bids checked against mandatory technical compliance
points; Qualifies or Disqualified, **no numeric ranking**." An earlier change (made when technical
scoring was unified to a 0-100 scale across every line) had every line -- including plain
Qualify/Disqualify ones -- go through the same `spec_compliance` score + 60-point weighted-average
threshold as Scored/QCBS lines; a Qualify/Disqualify line just skipped the T-rank step afterward. In
practice that meant an evaluator still had to type a number to qualify a bid even when there was
nothing to score (a vendor's syringe is either the size ordered or it isn't).

Reverted: `technical_evaluation.py`'s `consolidate()` now branches on `is_scored(line)` --
Qualify/Disqualify lines skip the score/weighting/threshold entirely and are a plain "any evaluator
disqualified it? then disqualified; otherwise qualified" rule, with `consolidated_score` and `t_rank`
both `None`. `evaluation.py`'s `save_evaluation()` and the technical-score-correction override
endpoint only call `clean_scores()`/`weighted_score()` when the line is actually scored. Scored/QCBS
lines are unchanged -- still require every non-optional criterion and the 60-point minimum, exactly as
before (regression-tested). The evaluate dialog (`evaluateDialog.js`) now renders a plain
Qualify/Disqualify radio choice with no score inputs at all for a non-scored line, instead of always
showing the full scoring grid; `lineDetail.js`'s line-summary panel and per-evaluator rows updated to
match (no "scored out of 100" language, no score number, for a non-scored line).

Disqualifying still requires a mandatory reason either way (spec's own rule, unrelated to scoring).
Verified end-to-end via API: a Qualify/Disqualify line now qualifies with an empty `scores: {}` payload
and records `consolidated_score`/`t_rank` as `None`; a Scored line still rejects an empty `scores`
payload with the same 422 as before.
