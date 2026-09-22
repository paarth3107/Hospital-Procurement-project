# E-Procurement Specification — Hospital Vendor & Tender Management

**Prepared By:** Mind IT Systems
**Prepared For:** Hospital Client / Internal Product Team
**Version:** 1.0 (Draft for Review)
**Status:** Draft
**Classification:** Confidential

> This is the authoritative functional & technical specification for the E-Procurement module. Where it disagrees with any other project document, this file wins.

Flow: Vendor Registration → E-Tender Creation & Approval → Selective Publishing → Bid Submission → L1 Selection & Approval → PO Data Handoff to ERP

---

## 1. Introduction

### 1.1 Purpose

Defines the functional and technical specifications for an E-Procurement module built for hospital and multi-facility healthcare procurement teams. Covers the complete lifecycle from vendor registration and onboarding through e-tender (RFQ/RFP) creation, tender approval and selective publishing to qualified vendors, vendor bid submission, L1 (lowest-price-qualified) selection at individual item/asset/service line-item level, L1 approval, and generation of a validated PO data file (CSV/XML) handed off to the hospital ERP, where the Purchase Order is formally created and issued.

### 1.2 Objective

- Digitize and standardize hospital procurement, replacing manual/offline vendor solicitation.
- Ensure only verified, rated, and eligible vendors are invited to bid on relevant tenders.
- Enable line-item (product/asset/service-level) competitive bidding instead of whole-tender single-vendor awards, so the hospital can multi-source a single tender across several vendors.
- Separate tender creation from tender approval, and L1 selection from L1 approval, so every publish and every award passes through an explicit, accountable approval gate.
- Provide an auditable, policy-compliant trail from requisition through L1 approval for statutory and internal audit purposes.
- Reduce cycle time between tender floating and handoff of the approved award to the hospital ERP for PO issuance.

### 1.3 Scope

**In scope:**
- Vendor self-registration, KYC/document verification, and approval workflow (Stage 1).
- Item/Asset/Service master and vendor mapping — including software development and software licensing as Service sub-categories (Stage 2).
- Vendor performance rating engine — Price Competitiveness computed automatically from this system's own bid history, all other parameters entered manually by Procurement Admin (Section 5) — used as an eligibility and tie-breaking input for tender publishing (Stage 3).
- E-Tender/Proposal creation across Item, Asset, and Service line items, with selective vendor eligibility resolution computed from mapping and rating, or an Open Tender option for unrestricted public participation via a generated link (Stage 4A, Section 6.8).
- A distinct E-Tender Approval step by an Approving Authority, with multi-round submission and rejection handling (Section 7.3), which is what triggers actual publishing and vendor notification (Stage 4B).
- Vendor bid/quotation capture portal, including document and image attachments (Stage 5).
- Technical and commercial (L1) evaluation and ranking at line-item level, including optional combined Technical+Price ranking (Stage 6).
- A distinct L1 Approval step by an Approving Authority, also with multi-round rejection handling, and generation of a validated PO data file (CSV/XML) per awarded vendor for upload into the hospital ERP (Stage 7).
- Multi-facility / multi-entity procurement, with tenders, vendor mapping, approval matrices, and PO data files all scoped by facility/legal entity (Section 2.3).

**Out of scope:** PO document creation, PO numbering, PO issuance to the vendor, vendor PO acknowledgment, and all downstream GRN/invoice/payment activity — these occur within the hospital ERP once it has ingested the Stage 7 export file. Full list in Section 16.

### 1.4 Intended Audience

- Hospital procurement / materials management team
- IT project stakeholders and approvers
- Mind IT Systems development, QA, and implementation team
- Empanelled vendors/suppliers (for the vendor-facing portal behavior described herein)

### 1.5 Definitions & Abbreviations

| Term | Definition |
|---|---|
| Vendor / Supplier | External entity registered to supply goods/services to the hospital |
| KYC | Know Your Customer/Vendor — statutory & compliance document verification |
| Product Master | Master catalog of purchasable Items, Assets, and Services used across the hospital, tagged by Procurement Type |
| Vendor Mapping | Association linking a vendor to the specific items, assets, services, or categories it is approved to supply |
| Vendor Rating / Scorecard | Computed performance score for a vendor based on quality, delivery, pricing history, compliance |
| E-Tender / Proposal / RFQ | Electronic Request for Quotation/Proposal floated for one or more line items with defined terms |
| Approving Authority | The role (resolved by the value-based approval matrix, Section 11.2) that approves an e-tender before publish (Stage 4B) or approves an L1 recommendation before PO handoff (Stage 7); may be a Department Head, Finance/Management Committee, or other configured role depending on value |
| Selective Publishing | Distribution of a tender only to the subset of vendors eligible by mapping and rating threshold, rather than to all registered vendors |
| Open Tender | A tender type that bypasses eligibility filtering and is published as a public link; any visitor can self-register and bid (Section 6.8) |
| Facility / Legal Entity | The single hospital facility or legal entity a tender, its vendor mapping, and its PO data file are scoped to, in a multi-facility deployment (Section 2.3) |
| T1, T2, T3… | Technical ranking of bids for a line item, T1 being the highest-scoring technically qualified bid (Section 9.2) |
| L1, L2, L3… | Commercial ranking of technically-qualified bids for a line item by price, L1 being the lowest (Section 9.3) |
| C1, C2, C3… | Combined Technical+Price ranking of bids under the optional QCBS method (Section 9.4) |
| LI / Line Item | An individual item/asset/service row within a tender, evaluated and awarded independently |
| PO | Purchase Order — formally created and issued within the hospital ERP after it ingests this system's Stage 7 export file |
| PO Data File | The CSV/XML file generated by this system after L1 Approval, containing awarded line-item data for one vendor, for upload into the hospital ERP |
| RFx | Generic term covering RFQ (Request for Quotation) and RFP (Request for Proposal) |

---

## 2. Solution Overview — End-to-End Process Flow

Seven-stage pipeline (Stage 4 and Stage 7 each carry a distinct approval gate). Each stage produces a system state that gates entry into the next stage; every transition is logged for audit.

| Stage | Description | Primary Actor | Key Output |
|---|---|---|---|
| 1 | Vendor Registration & Approval | Vendor / Procurement Admin | Approved, active vendor profile |
| 2 | Item/Asset/Service Master & Vendor Mapping | Procurement Admin / Category Manager / Vendor | Vendor eligible-to-supply matrix per item/asset/service or category |
| 3 | Vendor Rating & Scorecard | System (auto) + Procurement Admin (override) | Live vendor score, used for eligibility & tie-break |
| 4A | E-Tender Creation & Selective Publishing (Preparation) | Procurement Officer | Tender drafted; eligible vendor list resolved per line item, pending approval |
| 4B | E-Tender Approval | Approving Authority | Tender approved and published only to eligible, rated vendors per line item |
| 5 | Bid Submission | Vendor | Line-item-wise technical and commercial bid, with attachments |
| 6 | L1 Selection | System (auto) + Procurement Officer (recommend) | Technical (T) and commercial (L1/C1) ranking per line item; L1 confirmation recommended |
| 7 | L1 Approval | Approving Authority | Approved award per line item; CSV/XML file generated for upload into ERP for PO creation |

### 2.1 High-Level Process Narrative

1. A vendor registers on the portal and submits statutory/KYC documents; Procurement Admin reviews and approves or rejects (Stage 1).
2. Approved vendors are mapped to one or more items, assets, services, or categories in the master — by admin assignment, Category Manager approval, or vendor self-declaration subject to approval (Stage 2).
3. The system maintains a rolling performance rating per vendor, computed from historical order fulfillment, quality, delivery timeliness, and compliance data, with Procurement Admin override where justified (Stage 3).
4. A Procurement Officer drafts an e-tender/proposal against one or more Item/Asset/Service line items, sets commercial/technical terms and attachments, and the system auto-resolves the eligible vendor list per line item from mapping and rating (Stage 4A).
5. An Approving Authority reviews the drafted tender — including any manual vendor additions or guest invites — and approves it; this approval is what triggers actual publish and vendor notification, scoped to each vendor's eligible line items (Stage 4B).
6. Eligible vendors submit line-item-wise technical and commercial bids, with supporting documents/images, within the tender window (Stage 5).
7. At bid close, the system runs technical evaluation (T1, T2…) and commercial evaluation (L1, L2… or combined C1, C2… under QCBS) per line item, and the Procurement Officer reviews the comparative statement and recommends the award (Stage 6).
8. An Approving Authority reviews and approves the recommended award per line item (or applies a governed override); on approval, the system generates a validated PO data file (CSV/XML) per awarded vendor for upload into the hospital ERP, where the Purchase Order is formally created and issued (Stage 7).

### 2.2 End-to-End Process Swimlane

Swimlanes: Vendor · Procurement Officer · Category Mgr/Procurement Admin · Approving Authority · System (Engine) · ERP/Finance. Solid arrows = forward flow; dashed red arrows = the two rejection/rework loops (E-Tender Approval Stage 4B, and L1 Approval Stage 7) — a rejection sends the item back for revision and resubmission as a new round (Section 7.3) rather than ending the process.

Sequence: Vendor registers & submits KYC (1) → Admin verifies/approves (1) → Vendor requests item/asset/service mapping (2) → Admin/Category Mgr approves mapping; system computes rating (2/3) → Officer creates tender; system resolves eligible vendors (4A) → Officer submits tender for approval, Round N (4A) → [rejected → revise & resubmit, Round N+1] → Approving Authority reviews (4B) → System publishes & notifies eligible vendors (4B) → Vendor submits bid: technical + commercial + docs (5) → System locks bids at due date, unlocks for evaluation (6) → Category Mgr/Admin runs technical evaluation → T1, T2… (6) → System ranks commercial bids → L1/C1 (6) → Officer recommends award / L1 confirmation (6) → [rejected → re-evaluate & resubmit] → Approving Authority L1 Approval review (7) → System generates PO data file CSV/XML (7) → ERP ingests file, creates PO (7) → Vendor notified of award outcome (7).

### 2.3 Multi-Facility / Multi-Entity Procurement Model

Supports a hospital group operating multiple facilities or separate legal entities from a single deployment, rather than assuming one hospital per instance.

- Every tender carries a **Facility / Legal Entity** field at header level (Section 6.2), set by the Procurement Officer at creation; a tender, its bids, its L1 Approval, and its resulting PO data file are always scoped to exactly one facility/entity — there is no cross-facility tender in this model.
- **Vendor Mapping** (Module 2, Section 4.3) can be configured per facility as either **Group-wide** (a vendor approved once is eligible across every facility) or **Facility-specific** (a vendor must be separately mapped and approved per facility) — this is a hospital-policy configuration, not a per-tender choice.
- **Vendor Rating** (Module 3) is computed per vendor at the group level by default; a hospital that needs facility-specific rating (e.g., a vendor performs well at one site but poorly at another) can enable facility-scoped rating, which then requires facility-scoped manual entry (Section 5.3.1) per facility.
- The **value-based approval matrix** (Section 11.2) can be defined per facility/entity — a tender's Approving Authority is resolved using its own facility's matrix, not a single group-wide matrix, unless the hospital confirms a shared matrix is acceptable.
- The **PO data file** (Section 10.4) carries a **Facility/Entity Code** field so the hospital ERP can post the PO against the correct legal entity/cost center.
- Reporting and the audit trail (Section 12.6, Section 14) can be filtered per facility or consolidated across the group, depending on the viewing role's access scope.
- An **Open Tender's public link** (Section 6.8) is scoped to one facility/entity's tender; several concurrent Open Tenders across facilities generate a distinct link per tender, never a shared group-wide link.

---

## 3. Module 1 — Vendor Registration & Onboarding

### 3.1 Functional Description

Self-service vendor registration portal with document upload, admin review, and approval workflow. Only approved, active vendors become visible for product mapping and tender publishing.

### 3.2 Vendor Registration Fields

| Field Group | Fields | Mandatory |
|---|---|---|
| Company Details | Legal name, trade name, entity type, year of incorporation, registered address, branch locations | Yes |
| Statutory / Compliance | GSTIN, PAN, business license, drug license (for pharma/consumables vendors), MSME/Udyam registration, ISO/quality certifications | Yes (as applicable) |
| Banking Details | Bank name, account number, IFSC, cancelled cheque / bank letter upload | Yes |
| Contact Details | Primary contact person, designation, phone, email, escalation contact | Yes |
| Category Declaration | Product categories the vendor wishes to supply (feeds into Module 2 mapping request) | Yes |
| Commercial Terms | Standard payment terms, delivery lead time, minimum order value | Optional |
| Document Uploads | Incorporation certificate, tax registration, quality certificates, sample product catalog / price list | Yes |

### 3.3 Registration Workflow

1. Vendor submits online registration form with documents.
2. System runs basic validation (GSTIN/PAN format check, duplicate registration check by GSTIN).
3. Application enters 'Pending Verification' queue for Procurement Admin.
4. Admin verifies documents; may request clarification/re-upload (status: 'Info Requested').
5. Admin approves (status: 'Active') or rejects (status: 'Rejected', with reason captured).
6. On approval, system auto-triggers Module 2 to allow product-category mapping against the vendor's declared categories.

### 3.4 Vendor Statuses

| Status | Meaning | Can Vendor Bid? |
|---|---|---|
| Draft | Registration started but not submitted | No |
| Pending Verification | Submitted, awaiting admin review | No |
| Info Requested | Admin requires additional documents/clarification | No |
| Active | Approved and eligible for product mapping/tendering | Yes (if mapped + rated) |
| Suspended | Temporarily blocked (compliance lapse, poor performance) | No |
| Rejected / Blacklisted | Registration denied or vendor barred | No |

### 3.5 Key Business Rules

- Duplicate registration by GSTIN/PAN is blocked at submission.
- Statutory documents carry expiry dates; system flags vendors with expiring/expired compliance documents and can auto-suspend bidding eligibility until renewed.
- Vendor cannot be mapped to an item/asset/service (Module 2) or invited to a tender (Module 4A) unless status = Active.

---

## 4. Module 2 — Item, Asset & Service Master and Vendor Mapping

### 4.1 Functional Description

Maintains the hospital's procurable catalog — consumable Items, capital Assets, and Services — and the eligibility matrix that determines which active vendors may supply which entry. This mapping is the primary filter used later for selective tender publishing.

### 4.2 Master Attributes

Every catalog entry carries a **Procurement Type** of Item, Asset, or Service, which determines which additional attributes apply (Section 4.2.1).

| Field | Description |
|---|---|
| Code / SKU | Unique internal identifier |
| Name / Description | Descriptive name, specification, unit of measure |
| Procurement Type | Item / Asset / Service — drives the type-specific fields and the tender line-item form used in Module 4A |
| Category / Sub-category | e.g., Pharmaceuticals, Surgical Consumables, Implants (Item); Capital/Medical Equipment, IT Hardware (Asset); AMC, Housekeeping, Manpower, Biomedical Calibration, Software Development, Software Licensing (Service) |
| Regulatory Class | Drug schedule, implant class, or other regulatory tag driving compliance checks (Item/Asset) |
| Preferred / Approved Brands | Optional brand restriction list, where clinically mandated |
| Standard Reorder Level & Unit Price Band | Reference values used for budget and anomaly checks during bid evaluation |
| Active Flag | Whether the entry is currently procurable |

#### 4.2.1 Type-Specific Attributes

| Procurement Type | Additional Attributes |
|---|---|
| Item (consumables, pharmacy, general stores, surgical/medical supplies) | Unit of measure, pack size, shelf-life/expiry tracking flag, storage condition (e.g., cold chain), reorder level |
| Asset (capital/medical equipment, IT hardware, furniture) | Asset category, expected useful life, warranty period, installation/commissioning requirement, AMC/CMC applicability, required compliance certification (CE, BIS, ISO, FDA), site-readiness prerequisites (power, space, civil work) |
| Service (AMC/CMC, housekeeping, manpower outsourcing, biomedical calibration, security, dietary, laundry, software development, software licensing) | Standard SOW template, default service tenure/duration, SLA parameters (response time, uptime %, penalty clauses), billing basis (fixed/consumption/milestone), manpower deployment norms where applicable, plus software-specific attributes (Section 4.2.2) |

#### 4.2.2 Software Development / Licensing — Additional Attributes

Treated as Service sub-categories (procuring a deliverable/right-to-use rather than a physical good), but distinct enough to call out separately.

| Sub-category | Additional Attributes |
|---|---|
| Software Development / Custom Build | Deliverable-based SOW (milestones/sprints), source code ownership and escrow terms, IP assignment, acceptance testing criteria, warranty/defect-fix period post go-live, post-go-live support/AMC terms, technology stack constraints |
| Software Licensing (COTS/SaaS) | License type (perpetual/subscription/SaaS), license tenure and renewal terms, number of users/seats or usage tier, deployment model (on-prem/cloud/hybrid), data residency and DPDP Act compliance requirement, support/SLA tier, upgrade/patch policy, exit/data-portability terms |

### 4.3 Vendor Mapping

Many-to-many: one vendor may supply many items/assets/services or categories; one catalog entry may have many eligible vendors. Single source of truth for 'who can be invited' at tender time. Vendors may be mapped differently — and hold different ratings — across each Procurement Type.

1. Vendor requests mapping to an item/asset/service or category (at registration or later via 'Add Category' request), attaching supporting catalog, certification, or technical/service credentials.
2. Category Manager reviews and approves or rejects the specific mapping (category approval does not auto-approve every SKU/service line within it, unless configured for bulk approval).
3. Approved mappings are timestamped and versioned; removal/suspension of a mapping (e.g., after quality issue) is logged with reason.

### 4.4 Key Business Rules

- A vendor appears as a candidate for a tender line item only if an Active mapping exists for that exact item/asset/service or its parent category (configurable).
- Mapping approval may itself require a minimum vendor rating (Module 3) for restricted/critical categories (implants, high-value equipment, critical AMC services).
- Mapping changes take effect immediately for future tenders; tenders already published are unaffected.

---

## 5. Module 3 — Vendor Rating & Scorecard

### 5.1 Functional Description

Performance score per vendor, refreshed on a defined cadence. This system does not hold source data for most performance dimensions (delivery tracking, GRN/quality outcomes, compliance assessment live in the hospital ERP or are observed offline — Section 16). Only **Price Competitiveness** is computed automatically, from this system's own historical bid records. Every other parameter is entered manually by the Procurement Admin (Section 5.3.1). The rating drives (a) eligibility for selective tender publishing and (b) tie-breaking when two bids are equal at the L1 price.

### 5.2 Rating Parameters (Illustrative — to be finalized with hospital procurement policy)

| Parameter | Weight (Suggested) | Entry Mode | Source |
|---|---|---|---|
| On-time Delivery % | **25%** | Manual Entry | Procurement Admin, based on offline delivery/GRN tracking in the ERP |
| Quality Acceptance Rate | **25%** | Manual Entry | Procurement Admin, based on offline GRN rejection/return records |
| Price Competitiveness (historical) | **20%** | System-Computed | This system's own historical bid/L1 price records (Section 9.3) vs. category average |
| Compliance / Documentation Currency | **15%** | Manual Entry | Procurement Admin, based on periodic document/audit review |
| Responsiveness (bid participation & query turnaround) | **15%** | Manual Entry | Procurement Admin, based on observed tender participation and query turnaround |

### 5.3 Rating Computation & Refresh

- Price Competitiveness is the only sub-score the system computes automatically, derived from this system's own historical bid data (Section 9.3) at each rating refresh cycle — it does not depend on any external data source.
- All other sub-scores are manually entered by the Procurement Admin, since their source data is not available within this system (Section 5.3.1).
- The system computes the overall weighted composite score (0–100 or star scale, configurable) by combining the auto-computed Price Competitiveness sub-score with the latest manually entered sub-scores, refreshed whenever either changes.
- A rolling window (e.g., trailing 12 months) is used for the auto-computed Price Competitiveness sub-score, so old bid history ages out; manually entered sub-scores remain in effect until the Procurement Admin updates them again.
- New vendors with no transaction history receive a provisional/default score and are flagged 'Unrated' until a minimum number of POs are completed and at least one manual entry cycle has occurred.

#### 5.3.1 Manual Rating Entry Workflow

1. On a configured cadence (e.g., quarterly, or triggered after a PO/engagement closes), the system prompts the Procurement Admin with a rating entry form per vendor, listing the manual parameters and their last entered values.
2. The Procurement Admin enters a score (or percentage/rating) for each manual parameter, with a mandatory short comment for any parameter that changes materially from its prior value.
3. Manual entry is standard data entry, not a governed override — there is no automated baseline being overridden — but every entry is still logged with the entering Procurement Admin's identity and timestamp, and prior values are retained in history rather than overwritten.
4. Overriding the system-computed Price Competitiveness sub-score (the one parameter that is normally automatic) **is** a governed override, approved per the Manual Override Approval Workflow (Section 12), unlike the routine manual entry of the other four parameters.
5. If the Procurement Admin has not refreshed the manual parameters within a configured overdue window, the vendor's rating is flagged 'Stale — Manual Update Due'.

### 5.4 Use of Rating Downstream

- Tender publishing (Module 4A/4B) can set a minimum rating threshold per line item — vendors below threshold are excluded from the invite list even if mapped.
- Rating is used as a secondary sort/tie-breaker when bid prices are equal during L1 selection (Module 6).
- Vendors falling below a critical floor score can be auto-flagged for suspension review (feeds back to Module 1 status).

---

## 6. Module 4A — E-Tender Creation & Selective Publishing (Preparation)

### 6.1 Functional Description

Procurement Officer drafts a tender/proposal spanning one or more line items across Items, Assets, and Services — each independently configurable with commercial and technical terms appropriate to that type. A single tender may mix line items of different Procurement Types. This module also computes the per-line-item eligible vendor list from Vendor Mapping (Module 2) and Vendor Rating (Module 3), so the tender is fully prepared — but not yet published or visible to any vendor — pending the E-Tender Approval gate (Module 4B, Section 7).

### 6.2 Tender Header Fields

| Field | Description |
|---|---|
| Tender ID / Reference No. | System-generated unique reference |
| Tender Title & Description | Purpose and context |
| Tender Type | RFQ (price-only) / RFP (technical + commercial) / Rate Contract / Open Tender (Section 6.8) |
| Procurement Type(s) Included | Item / Asset / Service — one or more, selected at header level |
| Facility / Legal Entity | The single facility/legal entity this tender belongs to (Section 2.3) |
| Department / Requesting Unit | Originating hospital department within the selected facility |
| Publish Date & Bid Due Date | Tender window; system-enforced close time; publish only takes effect once approved |
| Minimum Vendor Rating Threshold | Default threshold applied to all line items, overridable per line |
| Minimum / Maximum Vendors to Invite per Line Item | Bounds the auto-resolved invite list size |
| Tender Terms & Conditions | Payment terms, delivery terms, penalty clauses, validity period |

### 6.3 Tender Line Items by Procurement Type

#### 6.3.1 Item Line Items

| Field | Description |
|---|---|
| Item / SKU (from Master) | Selected from Module 2 catalog |
| Required Quantity & UOM | Quantity being procured for this line |
| HSN/SAC Code | Auto-populated from Master, editable |
| Batch/Lot & Expiry Tracking (if applicable) | Flag inherited from Master for shelf-life items; requires vendor to declare expiry/shelf-life remaining at delivery |
| Alternate/Equivalent Brand Allowed (Y/N) | Whether a vendor may offer a clinically equivalent alternate brand, subject to Category Manager sign-off |
| Required Delivery Date / Location | Line-item-specific delivery expectation |
| Technical Specification Override | Line-specific notes in addition to master spec |
| Estimated / Budgeted Price (reference only) | Internal reference, not shown to vendors, used for bid variance checks |

#### 6.3.2 Asset Line Items

| Field | Description |
|---|---|
| Asset / Equipment (from Master) | Selected from Module 2 catalog |
| Required Quantity | Number of units being procured |
| Technical Specification & Compliance Requirement | Detailed spec, required certifications (CE/BIS/ISO/FDA), brand restriction |
| Warranty & AMC/CMC Requirement | Minimum warranty period sought, whether post-warranty AMC/CMC is quoted as part of this line or a linked Service line |
| Installation / Commissioning & Site-Readiness Notes | Site prerequisites (power, space, civil work), whether installation is included |
| Training Requirement | Whether user/biomedical staff training is included, minimum session count/duration |
| Spare Parts & Serviceability Commitment | Minimum period vendor must commit to spare-parts availability and service support |
| Old Asset Exchange / Buy-Back (if applicable) | Whether an existing asset is offered for exchange/buy-back, with reference asset ID |
| Required Delivery / Installation Date & Location | Line-item-specific delivery and installation timeline |
| Estimated / Budgeted Price (reference only) | Internal reference, not shown to vendors |

#### 6.3.3 Service Line Items

| Field | Description |
|---|---|
| Service (from Master) | Selected from Module 2 catalog |
| Scope of Work (SOW) | Detailed scope; may reference an attached SOW document |
| Service Tenure / Duration | Contract period (e.g., 12/24/36 months), renewal terms |
| SLA Parameters | Response time, uptime %, resolution time, penalty/liquidated-damages clauses |
| Billing Basis | Fixed periodic fee / consumption-based / milestone-based |
| Manpower Deployment Norms (if applicable) | Headcount, shift coverage, qualification requirements |
| Background Verification / Statutory Compliance Requirement | Police verification, PF/ESI compliance, other statutory obligations |
| Insurance / Indemnity Requirement | Minimum insurance cover the vendor must hold |
| Exit / Transition Clause | Handover/transition obligations at contract end or termination |
| Service Location(s) | Facility/department(s) where service is delivered |
| License / IP Terms (Software lines) | License type/tenure, seats/usage tier, source code ownership/escrow, IP assignment, data residency/DPDP compliance |
| Estimated / Budgeted Value (reference only) | Internal reference, not shown to vendors |

#### 6.3.4 Common Line-Item Controls (All Types)

- **Line-specific Minimum Rating Threshold** (optional) — overrides the tender default for sensitive/critical lines.
- **Split-Award Allowed (Y/N)** — whether this line's quantity/value may itself be split across more than one L1-tied vendor. *(See Sections 9.5 and 10.2 for how a split is proposed and approved.)*

#### 6.3.5 Type-Specific Business Rules

- The line-item form, mandatory-field set, and mandatory-attachment checklist (Section 6.4.1) are all driven by the line's Procurement Type; a Service line cannot be submitted for approval without a Scope of Work, and an Asset line above a configured value cannot be submitted without a technical specification attachment.
- For Asset lines carrying a linked Service (AMC/CMC) component, the two lines remain independently evaluated and independently awardable (Section 9), even though commercially bundled at tender level for vendor convenience.
- For Item lines flagged for batch/expiry tracking, the vendor's declared expiry/shelf-life is a mandatory bid field and is checked as part of technical qualification (Section 9.2) before price ranking.

### 6.4 Document & Image Attachments — Procurement Head

Procurement Head (or delegated Procurement Officer) can attach documents/images at header level and/or against individual line items.

- Header level: tender terms document, boundary/scope document, general drawings or floor plans, sample BOQ, reference photographs.
- Line-item level: technical specification sheets/datasheets, engineering drawings, reference/sample images, and — for Service lines — the SOW document.

#### 6.4.1 Mandatory Attachments by Procurement Type

| Procurement Type | Mandatory Attachment(s) | Optional / Recommended |
|---|---|---|
| Item | None mandatory by default (configurable per category, e.g., implants may require a reference image) | Packaging/label reference image, sample specification sheet |
| Asset | Technical specification sheet (mandatory above a configured line value) | Engineering drawing, site layout/floor plan, reference photograph |
| Service | Scope of Work (SOW) document | Site photograph, existing equipment/asset list (AMC/CMC lines), sample SLA report format |

The system enforces this checklist before a tender/line item can move out of Draft status; the Procurement Officer sees any missing mandatory attachment flagged at submission (Section 6.9).

#### 6.4.2 File Handling Requirements

- Accepted formats: PDF, DOCX, XLSX, JPG/PNG; per-file size limit and per-tender total attachment limit apply, both configurable.
- Every uploaded file is scanned for malware before storage/download; a failed scan blocks the upload and notifies the uploader.
- Image files show inline thumbnail/preview; document files show filename/size/type icon with preview-on-click where supported.
- Multiple files per header/line item; each carries a short description, uploaded-by stamp, timestamp.
- Attachments are versioned — replacing a file keeps the prior version accessible in history — and a version change after publish (Section 7.4) triggers a notification to all vendors already invited to that line item.

#### 6.4.3 Visibility & Access Control

- Header-level and line-item-level attachments are visible to every vendor invited to that tender/line item once published — a vendor cannot see attachments for a line item it was not invited to.
- Internally visible to all roles with tender view access (Section 11.1); uploading/replacing before publish is restricted to the Procurement Officer/Head who owns the tender, or an equivalent delegated role.

### 6.5 Eligibility Resolution Logic

The system computes a per-line-item eligible vendor list during preparation, using Vendor Mapping (Module 2) intersected with the Vendor Rating threshold (Module 3). This resolved list is what the Approving Authority reviews (Section 7.2), and what actual publish (Section 7.4) notifies — not the full vendor base.

Filter chain, in order, per line item:

1. Vendor status = Active (Module 1).
2. Vendor has an Active Vendor Mapping to the line item's item/asset/service or parent category (Module 2).
3. Vendor's current rating ≥ line-item (or tender-default) minimum rating threshold (Module 3).
4. Vendor is not currently Suspended/Blacklisted and has no expired mandatory compliance document.
5. If a Maximum Vendors to Invite cap is set and more vendors qualify, the system ranks qualifying vendors by rating (descending) and shortlists the top N.

The resulting per-line-item vendor list is unioned to produce the overall tender's proposed invite list; a vendor sees only the line items for which it individually qualified, not the full tender, once published.

- A vendor can never view or bid on a line item for which it lacks an active mapping, regardless of rating.
- If zero vendors qualify for a line item, the system blocks that line from moving to approval and alerts the Procurement Officer to relax the threshold or route for a manual sourcing exception (Section 6.6).
- All eligibility computations and manual overrides are stored as an immutable audit record against the tender.

### 6.6 Manual Override — Adding Vendors to the Proposed Invite List

Procurement Officer retains a manual override capability to add (or remove) vendors for a specific tender/line item.

- Available while the tender is in Draft/preparation, and — where configured — after publish for late-add scenarios.
- Every manual add/remove requires a mandatory reason code and free-text justification, captured against the Procurement Officer's user ID and timestamp.
- A manually added vendor can be an existing Active registered vendor not otherwise mapped/rated for that item/asset/service, or a vendor not yet registered at all (Unregistered Vendor Invite, Section 6.7).
- Every manual add/remove is a governed override: it does not take effect until approved through the Manual Override Approval Workflow (Section 12) — no unapproved path exists. Approver role resolved by override value/count (Procurement Admin default, escalating to Department Head above configured thresholds).
- Manually added vendors are visually flagged as 'Manually Invited', distinct from system-qualified vendors.

### 6.7 Inviting Unregistered Vendors (Guest Invite)

1. Procurement Officer enters the prospective vendor's name, email/mobile, and specific tender line item(s), and triggers 'Guest Invite'.
2. The guest invite is itself a governed override, routed through the Manual Override Approval Workflow (Section 12) before the invite is queued; within an Officer's own delegated authority this may be a self-attested approval, but is still a recorded, distinct workflow step.
3. On approval, system auto-creates a placeholder vendor profile in status 'Guest — Registration Incomplete' and generates a system-default login ID and temporary password; guest is added to the tender's proposed invite list.
4. The invite email/SMS with tender link, default user ID, and temporary password is queued and sent only once the tender is published (Section 7.4).
5. On first login, the vendor completes a short basic-details form (company name, contact person, phone/email, GSTIN/PAN if available, bank details) before line items become accessible, and must change the temporary password.
6. Once basic details are saved, vendor can view the specific line item(s) invited for and submit a quotation (Module 5, Section 8).
7. Full KYC upload and formal approval (Module 1) is not mandatory to bid, but is mandatory before confirmation as L1/award recipient — the system blocks PO data file generation (Section 10) until status upgrades from 'Guest' to 'Active'.
8. If the guest vendor does not complete basic details before the bid due date, the invite lapses and they're excluded from bid evaluation.

A guest vendor later confirmed as L1/award recipient triggers a **second, separate override approval** (Section 12) before PO data file generation, and is routed into the standard Module 1 registration/approval workflow at that point — no PO data is ever exported for an unverified vendor.

### 6.8 Open Tender — Public Vendor Participation

A tender can be configured as an **Open Tender**: bypasses eligibility filtering entirely, published as a public link, so any visitor can self-register and bid.

#### 6.8.1 How Open Tender Differs From Selective Publishing

- Tender Type = 'Open Tender' at creation; eligibility resolution (6.5), manual vendor-add (6.6), and officer-initiated Guest Invite (6.7) do not apply.
- On E-Tender Approval (4B), instead of a scoped vendor invite list, the system generates a unique public tender link (and, optionally, a QR code). Still requires the same Approving Authority sign-off and multi-round rejection handling (7.3) — only the meaning of 'publish' changes.
- Sharing the link externally (hospital website, newspaper notice, public procurement portal, social media) is a manual, outside-the-system activity.

#### 6.8.2 Public Self-Registration & Bidding

1. Visitor opens the public tender link, lands on a page scoped only to that tender's line items and public attachments — cannot browse/discover any other tender from that link.
2. Visitor completes a lightweight self-registration form on the landing page (company name, contact person, phone/email, GSTIN/PAN if available, bank details) — same minimum fields as Guest Invite — protected by anti-spam/anti-bot controls (e.g., CAPTCHA).
3. Same duplicate-registration check (by GSTIN/PAN) applies — a visitor already having a profile is matched to their existing record.
4. On successful self-registration, system creates a placeholder profile 'Guest — Registration Incomplete' (or resolves to existing Active profile) and immediately grants access to that tender's line items — no officer action needed, unlike Guest Invite.
5. Self-registered vendor submits a bid following the standard process (Module 5, Section 8), same attachment rules (8.3).
6. Full KYC and formal Procurement Admin approval remain not mandatory to bid, but mandatory before L1/award confirmation — PO data file generation blocked until status upgrades from 'Guest' to 'Active'.

#### 6.8.3 Evaluation & Key Business Rules

- Vendor Rating and Mapping do not gate participation in an Open Tender, but still apply normally for evaluation/tie-break if a self-registered vendor already has a rating; a genuinely new vendor is 'Unrated'.
- Technical Evaluation (9.2) is the primary safeguard on an Open Tender — should default to at least Qualify/Disqualify rather than skipping straight to price ranking, unless explicitly configured otherwise.
- Since the vendor pool is uncapped/self-selecting, 'Minimum/Maximum Vendors to Invite' doesn't apply; instead a **Maximum Bid Count** per line item may optionally bound evaluation load, closing registration/bidding early once reached.
- Technical/Commercial Evaluation (Module 6) and L1 Approval (Module 7) proceed identically regardless of entry path (selective invite, guest invite, Open Tender self-registration).
- The public link can be deactivated by Procurement Officer/Admin at the Bid Due Date, or earlier if withdrawn.

### 6.9 Draft Completion & Submission for Approval

1. Procurement Officer creates the tender in 'Draft' status: header, line items (across one or more Procurement Types), attachments, and — for a selectively-published tender — reviews the system-resolved eligible vendor list, manual overrides/guest invites; for Open Tender, this step confirms line items and public attachments for the landing page instead.
2. System validates the mandatory-attachment checklist (6.4.1) per line item and blocks submission until satisfied, or a documented exception is recorded.
3. System also blocks submission if any line item has zero eligible vendors and no manual override covers it (Open Tender lines exempt).
4. Procurement Officer submits for approval; tender status → 'Pending E-Tender Approval', routes to Approving Authority (Module 4B, Section 7).

---

## 7. Module 4B — E-Tender Approval & Publish

### 7.1 Functional Description

Explicit approval gate between tender preparation (4A) and the tender becoming visible to vendors. An Approving Authority (resolved by the value-based approval matrix, Section 11.2) reviews the prepared tender — including resolved eligible vendor list and any manual overrides/guest invites — and approves it. **This approval is what triggers actual publishing and vendor notification**; nothing in this module publishes on its own without that approval. Rejection is a first-class outcome, not an edge case (Section 7.3).

### 7.2 Approval Workflow

1. On submission from 4A, tender arrives in the Approving Authority's queue as 'Pending E-Tender Approval', with full comparative view: header terms, line items by Procurement Type, attachments, resolved eligible-vendor list per line item.
2. Any manual vendor addition (6.6) or guest invite (6.7) is shown with its reason code and, if still pending, its own override-approval status (Section 12) — **E-Tender Approval cannot be granted while a required override on the tender remains unresolved**.
3. Approving Authority approves or rejects the tender as a whole; a rejection returns it to 'Draft' status with mandatory comments, for revision and resubmission (Section 7.3).
4. Specific Approving Authority role resolved from the value-based approval matrix (Section 11.2) using the tender's total estimated value.
5. Approval logged with approver identity, timestamp, and any comments, as part of the permanent audit trail.

### 7.3 Multi-Round Submission & Rejection Handling

A tender is not limited to a single submit/approve cycle. The system tracks every submission as a numbered **Round**, so a tender can be revised and resubmitted as many times as needed until approved, withdrawn, or a configured round limit is hit.

1. Every submission from 4A increments the tender's Round counter (Round 1 on first submission); visible to both Officer and Approving Authority throughout.
2. On rejection, comments are mandatory and captured against that specific round; tender returns to 'Draft' with the round's comments pinned to the top of the editor.
3. Officer revises and resubmits — creates the next round (Round 2, Round 3…) rather than overwriting the rejected round, preserving full round-by-round history.
4. Each round retains its own snapshot: what was submitted, who reviewed it, the decision, comments, timestamp.
5. A configurable maximum round count (e.g., 3 rejections) triggers **escalation**: automatically routed to the next Approving Authority level up the value-based matrix (Section 11.2), rather than looping indefinitely.
6. A configurable per-round SLA (e.g., 3 business days) can trigger a reminder, and — if configured — an escalation identical to the round-limit escalation, if no decision is recorded in time.
7. Officer may withdraw at any round instead of resubmitting; status → 'Withdrawn', exits the cycle without consuming a further round.
8. No cap on rounds by default — only the escalation trigger — since a hard cap that blocks resubmission would stall genuine procurement needs; configurable if hospital policy requires one.
9. **Multi-round tracking applies identically to the L1 Approval gate** (Module 7, Section 10.2) — a rejected award recommendation is likewise revised, resubmitted, and round-tracked.

### 7.4 Publish Actions

- On E-Tender Approval (whichever round), status → 'Published'. For selectively-published tenders, notifications (portal + email/SMS) sent only to the resolved vendor list (6.5), including approved manual additions and guest invites, scoped to each vendor's eligible line items.
- For Open Tender, 'Published' instead activates the public tender link/QR code — no scoped vendor list to notify.
- Bid submission window opens per the tender's Publish Date/Bid Due Date.
- **A tender cannot be published — and no vendor notified, nor any public link activated — without having passed E-Tender Approval** — there is no direct-publish path from Module 4A, regardless of how many rounds it took.

### 7.5 Key Business Rules

- Only an Approving Authority resolved by the value-based matrix can approve a tender for publish; a Procurement Officer cannot self-approve their own tender above the matrix's self-attestation threshold.
- Any edit to the tender after Approving Authority review restarts the approval step as a new round; returns to 'Pending E-Tender Approval' for the same or an escalated Approving Authority.
- The approval decision, and the exact eligible-vendor list and terms that were approved, are retained together per round.

---

## 8. Module 5 — Bid Submission (Vendor)

### 8.1 Functional Description

Portal for invited vendors to submit line-item-wise quotations against the tender they were notified for.

### 8.2 Bid Capture Fields (per line item)

| Field | Description |
|---|---|
| Unit Price & Total Price | Vendor's quoted price for the line item quantity |
| Taxes / Duties | GST and other applicable levies, itemized |
| Delivery Lead Time | Vendor-committed delivery timeline for this line |
| Payment Terms Offered | If tender allows vendor-proposed terms |
| Technical Compliance Statement | For RFP-type tenders — compliance to specification, with supporting document upload |
| Validity of Quote | Number of days the quoted price remains valid |

### 8.3 Vendor Document & Image Upload

- Bid level: company compliance certificates, authorization letters, general product/service catalog.
- Line-item level: technical compliance/datasheet document (mandatory for RFP-type), product/asset photographs, brand/model certification, warranty document (Asset lines), and for Service lines — vendor's proposed SOW/method statement responding to the hospital's SOW.

#### 8.3.1 Mandatory Vendor Attachments by Procurement Type

| Procurement Type | Mandatory Vendor Attachment(s) | Optional / Recommended |
|---|---|---|
| Item | None mandatory by default (configurable, e.g. pharmacy items may require batch/shelf-life declaration) | Product photograph, packaging sample image |
| Asset | Technical compliance/datasheet document responding to spec; manufacturer authorization letter (if bidding as distributor) | Product photographs, brand/model certification, warranty document, training-plan note |
| Service | Proposed SOW/method statement; manpower deployment plan (where applicable) | Site-visit acknowledgment, sample SLA report format, insurance/indemnity proof |

- System blocks final bid submission for a line item until mandatory attachments are present; vendor can save an incomplete bid as draft.

#### 8.3.2 File Handling & Submission Validation

- Same accepted formats/size limits as Procurement Head uploads (6.4.2).
- Every uploaded file scanned for malware before storage; failed scan blocks upload.
- Multiple files per line item; replaceable before submission; locks with the rest of the bid at the submission deadline (9.6).

#### 8.3.3 Visibility & Confidentiality

- Vendor-uploaded attachments visible only to the uploading vendor; internal evaluators can view once the bid is unlocked for evaluation, following the same price-confidentiality timing as Section 9.6.
- Attachment access by internal evaluators is logged (viewer, timestamp) as part of the audit trail covering bid price access.

### 8.4 Workflow & Rules

- Vendor can save as draft and submit before due date/time; submissions lock automatically at close.
- Vendor may bid on a subset of eligible line items; partial bidding allowed unless tender mandates all-or-nothing.
- **Sealed-bid behavior**: quoted prices from all vendors hidden from other vendors and from the internal Procurement Officer (where two-envelope/technical-commercial separation is configured) until the bid window officially closes.
- Late submissions rejected automatically; accepting a late submission is a governed override (Section 12) before the bid is unlocked for evaluation — no direct/unapproved acceptance path.

---

## 9. Module 6 — L1 Selection: Technical & Commercial Bid Evaluation (Line-Item Level)

### 9.1 Functional Description

At bid close, the system evaluates all received quotations independently for each line item — not the tender as a whole. For RFP-type tenders (and any RFQ line marked as requiring technical scoring), evaluation runs in two stages: Technical Evaluation → T1, T2, T3… ranking, then Commercial Evaluation → L1, L2, L3… price ranking among technically-qualified vendors. Produces a recommended award per line item (L1 default, or C1 where combined ranking is configured); the recommendation is **not itself an approval** — final sign-off is L1 Approval (Module 7, Section 10), which is where a single tender's line items may end up awarded across multiple vendors, one per line item (or split further where Split-Award is enabled).

### 9.2 Technical Evaluation & T-Ranking

#### 9.2.1 Evaluation Method (Configurable per Tender/Line Item)

- **Qualify/Disqualify** (default for standard Item lines) — bids checked against mandatory technical compliance points; Qualifies or Disqualified, no numeric ranking, all Qualified bids proceed to commercial evaluation on equal footing.
- **Scored Technical Ranking** (Asset and Service lines, and any Item line flagged technically sensitive) — each bid scored against weighted criteria (9.2.2) to produce a Technical Score → T1, T2, T3…, T1 = highest-scoring technically qualified bid.

#### 9.2.2 Technical Scoring Criteria (Illustrative — configurable per category)

| Criterion | Applies To | Suggested Weight |
|---|---|---|
| Compliance to technical specification | Item, Asset, Service | 35% |
| Vendor's current rating (Module 3) | Item, Asset, Service | 15% |
| Warranty, spares/serviceability commitment, or training plan | Asset | 20% |
| Proposed SOW / method statement quality and SLA commitment | Service | 20% |
| Manufacturer authorization / brand certification | Asset | 10% |
| Manpower deployment plan and statutory compliance readiness | Service | 15% |
| Past performance on similar line items (if history exists) | Item, Asset, Service | 15% |

#### 9.2.3 Technical Evaluation Workflow

1. Opens strictly after the bid due date/time has passed (9.6), same simultaneous-unlock rule as commercial data.
2. A designated Technical Evaluator/Committee (role configured per category) scores each bid against 9.2.2, or records Qualify/Disqualify.
3. Where multiple evaluators score independently, system averages/consolidates per configured method (simple average, or exclude-outlier average); retains each evaluator's individual score.
4. Bids ranked by consolidated Technical Score, highest to lowest → T1, T2, T3…
5. A minimum qualifying Technical Score (e.g., 60/100) configurable per line item; below it = Technically Disqualified, excluded from commercial evaluation regardless of T-rank.
6. Tie-break: equal top Technical Score → prefer higher current rating (Module 3); still tied → earliest submission timestamp wins, or routed for manual decision.
7. A technical comparative statement (T1/T2/T3… ranking) is auto-generated alongside the commercial comparative statement (9.3).

#### 9.2.4 Key Business Rules

- Commercial (price) bids remain masked to the Technical Evaluator during scoring, wherever two-envelope separation is configured.
- A Technically Disqualified bid's price is never opened/ranked for that line item; vendor receives a technical-disqualification notice separate from commercial regret notice.
- Changing a submitted technical score after recording is a **governed override** (Section 12), correction reason logged alongside original and revised score.

### 9.3 Commercial (Price) Evaluation & L-Ranking

1. Runs only among Technically Qualified bids (9.2).
2. Among qualified bids, system ranks by landed price (unit price + tax + any normalized freight/logistics adder, if configured).
3. Lowest-ranked bid = **L1**; subsequent = L2, L3, etc.
4. Tie-break: equal L1 price → prefer higher current rating (Module 3), then higher Technical Score/T-rank if scored technical evaluation used; still tied → earliest submission timestamp, or manual decision.
5. Comparative statement (combining T-rank and L-rank) auto-generated for procurement review.

### 9.4 Combined Ranking Method (Optional — QCBS)

For Asset and Service lines where quality should carry weight alongside price:

- **Combined Score = (Technical Score % × Technical Weight) + (Price Score % × Price Weight)**, Technical/Price Weight configurable per line item (common starting point: **70% technical / 30% price** for critical Assets, or **60/40** for Services).
- Price Score normalized so the lowest bid among technically-qualified vendors scores 100%, others scored proportionally against it.
- Vendors ranked by Combined Score, highest to lowest → **C1, C2, C3…**; where QCBS configured, recommendation follows C1 rather than L1.
- The evaluation method (pass/fail + L1, scored technical + L1, or QCBS combined) is **fixed per line item at tender creation** (6.3) and cannot change after publish without a governed override (Section 12) — vendors always know upfront how they'll be evaluated.

### 9.5 Recommendation & Comparative Statement (L1 Confirmation)

- System recommends the top-ranked bid per line item (L1 default, or C1 where QCBS configured); Procurement Officer reviews the technical and commercial comparative statements and **confirms** the recommendation — this is the 'L1 confirmation' handed to L1 Approval (Module 7, Section 10) and **does not by itself award or notify any vendor**.

- **Split-Award** — *this is the feature the wireframe was missing:*
  - Where Split-Award is enabled on a line item (flagged at tender creation, Section 6.3.4), the Procurement Officer **may propose a split allocation across more than one vendor** (e.g., **70% to L1/C1, 30% to L2/C2**) rather than 100% to a single vendor.
  - Subject to configured **minimum split thresholds** (i.e., a hospital-configured floor so a split isn't proposed as, say, a meaningless 99%/1%).
  - The proposed split is **carried forward for L1 Approval to confirm or adjust** (Section 10.2) — the Approving Authority has the final say on the exact allocation, not just a yes/no on the Officer's proposal.

- If the Procurement Officer wishes to recommend a non-top-ranked bid instead of the system's default recommendation, this is a **governed override**: mandatory reason code, doesn't take effect until approved (Section 12) before it can be forwarded as a recommendation.
- Recommendation per line item is independent; overall tender can show mixed status (some lines recommended, some still under evaluation) until all lines are finalized.
- Once all line items have a confirmed recommendation, tender status → 'Pending L1 Approval', routes to Approving Authority (Module 7, Section 10).

### 9.6 Bid Price Confidentiality & Tender Timeline Control

- Vendor-quoted prices remain hidden from **all** users — including Procurement Officer, Category Manager, and Approving Authority — until the tender's Bid Due Date/Time has elapsed. Only submission status (Submitted/Not Submitted) and non-price fields configured as visible are shown before close.
- Masking applies per line item where line items carry independent due dates.
- Once the submission date/time is crossed: technical submissions unlock first for Technical Evaluation; prices for all received bids unlock simultaneously for Commercial Evaluation only **after** technical qualification is recorded — preventing any evaluator from seeing one vendor's price before another's, or before its technical standing is settled.
- Procurement Officer can extend the Bid Due Date/Time before the original deadline lapses. **Every extension is a governed override** (reason code, approved per Section 12) — a short first extension may be self-attested within delegated authority, but is still a recorded approval step.
- An extension raises the deadline only; does not unlock/expose any prices already submitted.
- Extensions beyond a configured number of days, or number of extensions per tender, escalate to Procurement Admin approval.
- All invited vendors auto-notified of a revised due date the moment an extension is confirmed.
- Once the (possibly extended) due date passes and prices unlock, the due date is locked — cannot be further extended/reopened; further changes require a fresh tender or documented re-tender exception.

---

## 10. Module 7 — L1 Approval & PO Data Handoff to ERP

### 10.1 Functional Description

Final approval gate before an award becomes binding. Approving Authority (resolved by the value-based matrix, Section 11.2) reviews the recommendation forwarded from L1 Selection (Module 6, Section 9.5), approves each line item's award (or applies a governed override), and on approval the system generates a validated PO data file (CSV/XML) per awarded vendor. That file is the system's final output; the hospital ERP ingests it to formally create and issue the PO — PO document generation, numbering, issuance, dispatch, and vendor acknowledgment all occur within the ERP, outside this system's boundary (Section 16).

### 10.2 L1 Approval Workflow

1. On submission from Module 6, tender arrives in queue as 'Pending L1 Approval', with full technical/commercial comparative statements per line item and the Officer's recommendation (L1/C1, or proposed split allocation).
2. Approving Authority reviews each line item's recommendation and approves it, or applies a governed override to award a non-top-ranked bid instead — mandatory reason code, doesn't take effect until approved (Section 12); approver role for the override itself resolved by award value.
3. **Where Split-Award was proposed (Section 9.5), the Approving Authority confirms or adjusts the quantity allocation across vendors, subject to configured minimum split thresholds.** This is the final decision point for a split award — the Officer proposes, the Approving Authority confirms/adjusts.
4. Approval per line item is independent; overall tender can show mixed status until every line item has a final decision.
5. Approving Authority may instead reject a line item's recommendation outright with mandatory comments; the line item returns to Module 6 (9.5) for re-evaluation and resubmission, following the same round-tracking/escalation rules as tender approval (7.3) — each rejected line item accumulates its own round history and escalates if repeatedly rejected or SLA-breached.
6. Once every line item has been approved (or explicitly excluded from award), tender status → 'Awarded — Approved for Export', triggering PO data file generation (10.3).
7. Approving Authority role resolved from the value-based matrix using the line item's/tender's award value.

### 10.3 PO Data File Generation (CSV/XML)

- On L1 Approval, system generates **one PO data file per awarded vendor**, consolidating all line items awarded to that vendor within the tender (across Item, Asset, Service as applicable). *A split-award line item therefore contributes to more than one vendor's file, each carrying only that vendor's allocated share.*
- Produced in CSV or XML (configurable to match hospital ERP's import capability); traceable line-by-line back to the approved bid — every price, quantity, and term must match exactly what was approved (10.2), no manual editing outside a governed re-export (10.5).
- Each file carries a unique PO Data Batch ID, tender reference, vendor code, Approving Authority identity, and approval timestamp.

### 10.4 PO Data File — Field Specification (Illustrative)

Exact column/element names to be finalized against the hospital ERP's import template (Section 17). Minimum data set:

| Field | Description |
|---|---|
| Tender Reference / PO Data Batch ID | Links export back to source tender and approval record |
| Vendor Code / GSTIN | Vendor identifier as recognized by the ERP vendor master |
| Line Item Code (Item/Asset/Service) | As mapped to the ERP's item master, where such a mapping exists |
| Description, Quantity, UOM | As awarded (10.2) |
| Unit Price, Tax, Line Total | As awarded (10.2), post any Split-Award allocation |
| Delivery / Service Terms | Delivery date/location (Item/Asset), or service tenure/location (Service) |
| Payment Terms | As agreed in tender/bid |
| Approving Authority ID & Approval Timestamp | Traceability back to L1 Approval decision |
| Department / Requesting Unit & Budget Code (if applicable) | For ERP-side budget posting |
| Facility / Legal Entity Code | Identifies which facility/legal entity the PO posts against |

### 10.5 Upload & ERP Handoff Process

1. Generated file enters status 'Pending Upload'.
2. Depending on integration pattern (Section 13), pushed automatically via API/SFTP, or downloaded by Procurement Admin and manually uploaded into the ERP's PO-creation import screen.
3. On successful ingestion, ERP creates the PO and — where a return channel exists — reflects the ERP-side PO number back into this system, status → 'Imported — PO Created in ERP'; where no return channel exists, Procurement Admin manually confirms reconciliation.
4. On ingestion failure (e.g., unrecognized vendor/item code), ERP's rejection reason recorded, status → 'Import Failed'; Procurement Admin corrects underlying data and triggers a re-export.
5. A re-export after correction is a **governed override** (Section 12) — a previously-approved award cannot be silently altered before being re-sent to the ERP.

### 10.6 Vendor Notification of Award

- On L1 Approval, system notifies each awarded vendor of 'Awarded' status, awarded line items, quantities, price — independent of, and ahead of, the ERP's own PO issuance/dispatch.
- Non-awarded but technically qualified vendors (L2+/T2+/C2+) receive a regret notification, per line item bid on, once L1 Approval finalized.
- Technically disqualified vendors receive a separate technical-disqualification notice, distinct from commercial regret, once the technical stage (9.2) is confirmed.

### 10.7 Key Business Rules

- Every value in a generated PO data file must trace back exactly to an L1-Approved line item; no direct-edit path on the file itself, only the governed re-export flow (10.5).
- Generated files are versioned — a re-export supersedes the prior file for that vendor/tender combination but does not delete it.
- PO document creation, numbering, issuance, vendor acknowledgment, and all downstream GRN/invoice/payment activity are performed within the hospital ERP once it ingests the file — this system's responsibility ends at a successfully generated (and, where automated, transmitted) PO data file.

---

## 11. Roles, Permissions & Approval Workflow

### 11.1 Roles & Permissions Matrix

| Role | Vendor Reg. | Item/Asset/Service Mapping | Rating Override | Tender Create (4A) | Tender Approve/Publish (4B) | L1 Selection (Recommend, 6) | L1 Approval (7) |
|---|---|---|---|---|---|---|---|
| Vendor (external) | Self-submit | Request only | View own | — | View/Bid | View outcome | View outcome |
| Procurement Officer | Review | Propose | — | Create & Submit | Prepare for approval | Recommend (L1/C1) | — |
| Category Manager / Technical Evaluator | — | Approve | — | Review | Review | Technical scoring (9.2) | — |
| Procurement Admin | Approve/Reject | Approve | Adjust (approval-gated) | Approve threshold config | Approve (low value) | Review | Approve (low value) |
| Approving Authority (Dept. Head / Finance-Mgmt. Committee) | — | — | — | — | Approve (value-based) | Review | Approve (value-based) |
| System Admin | Config | Config | Config | Config | Config | Config | Config |

### 11.2 Illustrative Approval Matrix (Value-Based — to be aligned with hospital policy)

"Approving Authority" is the generic role name used throughout for whoever holds the approval gate at Stage 4B and Stage 7; specific person/role resolved from this matrix by value. For multi-facility/multi-entity deployments (Section 2.3), resolved per the tender's own Facility/Legal Entity — value bands below are illustrative defaults, may be configured differently per facility.

| Value Band | E-Tender Approval (4B) | L1 Approval (7) |
|---|---|---|
| Up to ₹1,00,000 | Procurement Admin | Procurement Admin |
| ₹1,00,001 – ₹10,00,000 | Department Head | Department Head |
| Above ₹10,00,000 | Department Head + Finance/Management Committee | Finance / Management Committee |

ERP-side approvals that may apply to the Purchase Order itself (e.g., finance sign-off within the ERP's own workflow) are governed by the hospital's ERP configuration and out of scope here.

---

## 12. Manual Override & Exception Approval Workflow Engine

### 12.1 Purpose

Every manual override referenced elsewhere in this spec — vendor rating adjustment, adding a vendor to a tender's proposed invite list, guest-vendor invite, technical evaluation score correction, late-submission exception, bid due-date extension, non-L1/non-C1 award override, and PO data re-export — runs through **one common, configurable approval workflow** rather than separate ad hoc logic per module. No override anywhere in this specification takes effect on the record it modifies until its workflow instance reaches 'Approved' status.

### 12.2 Governing Rule

Every manual override, without exception, must pass through this workflow before it changes system state. The only variable is which role must approve it and whether that approval is self-attested (an officer approving a low-risk action within their own delegated authority, still recorded as a distinct step) or requires a separate approver. **There is no override path — in any module — that bypasses this engine.**

### 12.3 Override Types Governed by This Engine

| Override Type | Source | Default Approver | Escalates To |
|---|---|---|---|
| Override of system-computed Price Competitiveness score | Section 5.3.1 | Procurement Admin | Department Head — if adjustment exceeds a configured score-point range |
| Add vendor to tender's proposed invite list (registered vendor) | Section 6.6 | Procurement Admin | Department Head — if cumulative override value on the tender exceeds a configured threshold |
| Guest vendor invite (unregistered) | Section 6.7 | Procurement Officer (self-attested) | Procurement Admin — if guest count per tender exceeds a configured limit, or a guest vendor is confirmed as awardee |
| Technical evaluation score correction | Section 9.2.4 | Procurement Admin | Department Head — if the correction changes the T1/qualification outcome for the line item |
| Late bid submission exception | Section 8.4 | Procurement Admin | Department Head — if the tender's value exceeds a configured threshold |
| Bid due-date extension | Section 9.6 | Procurement Officer (self-attested, first extension) | Procurement Admin — beyond a configured number of days or number of extensions |
| Non-L1/Non-C1 award override | Section 10.2 | Procurement Admin | Finance/Management Committee — if award value exceeds a configured threshold |
| PO data file re-export after correction | Section 10.5 | Procurement Admin | Department Head — if the re-export changes price/quantity from the originally approved award |

### 12.4 Generic Workflow States

Every override instance, regardless of type, moves through the same state machine:

1. **Requested** — initiator submits the override with a mandatory reason code and free-text justification; target record not yet changed.
2. **Pending Approval** — engine resolves the required approver role (12.3, plus any escalation trigger), routes a task/notification to that role.
3. **Approved** — approver confirms; override applied to target record, stamped with approver identity and timestamp.
4. **Rejected** — approver declines with mandatory rejection reason; override discarded, initiator notified, underlying record left unchanged.
5. **Escalated** — value/count crosses an escalation trigger, or assigned approver doesn't act within a configured SLA window; task auto-re-routes to the next role up the chain.
6. **Expired** (configurable) — override left pending beyond a configured SLA without action is auto-rejected and logged.

### 12.5 Role Resolution Rule

- Engine resolves the required approver as: Override Type (12.3) → Value/Count Band, where applicable → mapped Approver Role, escalating per the 'Escalates To' column when the band is exceeded.
- A 'self-attested' approval (e.g., Procurement Officer approving a single guest invite or a short date extension within their own delegated authority) is still recorded as a distinct Approved step — auto-approved within that authority, not skipped.
- Approver roles and value/count bands in 12.3 are illustrative and should be finalized against the hospital's delegation-of-authority policy (Section 17, Open Questions).

### 12.6 Audit & Traceability

- Every override instance retains: initiator, override type, reason code, justification text, approver, decision, decision timestamp, and — where escalated — the full escalation path.
- The override audit trail is queryable independently per type (e.g., 'all rating overrides in the last quarter', 'all non-L1 award overrides this year') and feeds the same audit log referenced under Auditability (Section 14).

---

## 13. Integration Requirements

### 13.1 System-Level Integration Inventory

| System | Direction | Purpose |
|---|---|---|
| Hospital ERP / Finance (e.g., SAP) | Bi-directional | PO data file (CSV/XML) import for PO creation after L1 Approval; optional budget check against tender value before E-Tender Approval; vendor master sync |
| Hospital Information System (HIS) | Inbound | Consumption/reorder triggers that seed requisitions feeding tender creation |
| Email / SMS Gateway | Outbound | Vendor notifications for registration status, tender invite, publish, award, due-date extension |
| Document/DMS Storage | Bi-directional | Storage of vendor KYC docs, tender attachments (Procurement Head uploads), vendor bid attachments |
| Digital Signature Provider (optional) | Outbound | e-Signing of E-Tender Approval and L1 Approval records where mandated |
| GST/PAN Verification API | Outbound | Automated statutory ID validation at vendor registration and Open Tender public self-registration |
| CAPTCHA / Anti-Bot Provider (optional) | Outbound | Spam/bot protection on the public Open Tender self-registration form |

### 13.2 Integration Touch Points by Process Stage

| Stage | Trigger | System | Data Exchanged | Direction |
|---|---|---|---|---|
| 1 | Vendor submits registration | GST/PAN Verification API | GSTIN, PAN → validation result | Outbound / Inbound |
| 1 | KYC document upload & approval | Document/DMS Storage | KYC documents | Bidirectional |
| 2 | Vendor mapping request/approval | Document/DMS Storage | Supporting catalog/certification documents | Bidirectional |
| 4A | Tender drafted (optional budget check) | Hospital ERP / Finance | Estimated tender value, budget/cost-center code → check result | Outbound / Inbound |
| 4A | Tender/line-item attachments added | Document/DMS Storage | Tender attachments (specs, drawings, SOW, images) | Bidirectional |
| 4B | Tender approved and published | Email / SMS Gateway | Tender invite link, eligible line items, (guest invite credentials where applicable) | Outbound |
| 4B | Open Tender published (public link) | CAPTCHA / Anti-Bot Provider | Bot-check challenge/response on the public landing page | Outbound / Inbound |
| 4B/5 | Visitor self-registers via Open Tender link | GST/PAN Verification API | GSTIN, PAN → validation result | Outbound / Inbound |
| 5 | Vendor submits bid | Document/DMS Storage | Vendor bid attachments (compliance docs, images, SOW response) | Bidirectional |
| 6 | Bid due date extended | Email / SMS Gateway | Revised due-date notification | Outbound |
| 7 | L1 Approval confirmed | Hospital ERP / Finance | PO data file (CSV/XML): vendor, line items, price, terms, facility/entity code, approval reference | Outbound |
| 7 | ERP ingests PO data file | Hospital ERP / Finance | Import confirmation / rejection reason, ERP-side PO number (where a return channel exists) | Inbound |
| 7 | Award confirmed / regret decided | Email / SMS Gateway | Award notification, regret notification, technical-disqualification notice | Outbound |
| Downstream (out of scope) | PO issued, goods/services delivered | Hospital ERP / Finance | PO issuance, GRN, invoice, payment — referenced only, not built here | N/A |

---

## 14. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | Role-based access control; encrypted storage of vendor banking/KYC data; sealed-bid confidentiality until close |
| Auditability | Immutable audit log for registration approvals, mapping changes, rating overrides, E-Tender Approval (4B), L1 Approval (7) decisions and overrides, and PO data file generation/re-export |
| Availability | Vendor bid portal available 99.5%+ during active tender windows |
| Performance | Eligibility resolution (Section 6.5) for a tender with up to 500 mapped vendors and 100 line items to complete within a few seconds |
| Scalability | Support multi-facility hospital groups with shared or facility-specific vendor pools |
| Notifications | Email/SMS/portal alerts for all status transitions affecting vendors and internal approvers |
| Data Retention | Tender, bid, approval, and PO data file export records retained per statutory audit requirements (typically 7+ years, to be confirmed with client policy) |
| Data Integrity | PO data files (Section 10.3) must be generated only from L1-Approved records, with every field traceable to the approving decision; no direct-edit path on a generated file |
| Localization | Multi-currency not required (assume INR only) unless cross-border vendors are in scope |

---

## 15. Assumptions

- Vendor rating parameters and weights (Section 5.2) are illustrative and will be finalized jointly with the hospital's procurement policy team.
- Approval value bands (Section 11.2) are placeholders pending the hospital's delegation-of-authority document.
- Single currency (INR) and single-country GST/PAN compliance are assumed; multi-country vendor onboarding is not assumed unless confirmed.
- Budget/requisition origination is assumed to be either manual entry or an HIS/ERP-driven reorder trigger; the requisition/indent module itself is an upstream dependency, not built fresh here unless explicitly scoped.
- PO document creation, PO numbering, PO issuance, vendor acknowledgment, GRN, delivery tracking, and invoice/payment reconciliation are all performed within the hospital ERP once it ingests this system's Stage 7 PO data file; this system's responsibility ends at a successfully generated (and, where automated, transmitted) export file.
- The exact CSV/XML field mapping (Section 10.4) is illustrative and will be finalized against the hospital ERP's actual PO-import template.
- One hospital/legal entity is assumed per deployment instance unless multi-facility support is explicitly confirmed as in-scope.

---

## 16. Out of Scope

- Requisition/Indent management module (assumed upstream trigger, not built as part of this specification).
- PO document creation, PO numbering, PO issuance to the vendor, and vendor acknowledgment of the PO — performed within the hospital ERP after it ingests the Stage 7 PO data file.
- Goods Receipt Note (GRN), inventory/warehouse management, and stock issuance.
- Invoice processing, three-way matching, and vendor payment execution (handed off to ERP/Finance).
- Any approval workflow the ERP itself applies to the Purchase Order after import (governed by the hospital's ERP configuration, not this system).
- Contract lifecycle management for long-term rate contracts beyond basic Rate Contract tender type.
- Reverse auction / live e-auction bidding mechanics (can be scoped as a future enhancement).
- Mobile native app (assumption: responsive web portal only, unless confirmed otherwise).
- Vendor credit/financial risk scoring beyond the performance rating described in Module 3.

---

## 17. Open Questions / Client Inputs Required

1. Final rating parameter weights and minimum rating thresholds per item/asset/service category/criticality.
2. Approval value bands and designated Approving Authority roles per hospital's actual delegation-of-authority policy, including the specific bands for each override type in Section 12.3.
3. Confirm whether Vendor Mapping and Vendor Rating should be Group-wide or Facility-specific by default (Section 2.3), and whether the approval matrix (Section 11.2) is shared group-wide or set independently per facility/legal entity.
4. **Is Split-Award (dividing one line item's quantity across multiple vendors) required from Phase 1, or can it be a Phase 2 enhancement?** *(Resolved for this project: Phase 1 — see CLAUDE.md.)*
5. Which upstream system (HIS/ERP/manual) originates the requisition that seeds tender creation?
6. What is the hospital ERP's exact PO-import file format and field mapping (Section 10.4) — CSV or XML, required column/element names, and any mandatory reference/budget codes?
7. Is the PO data file handoff to the ERP (Section 10.5) automated (API/SFTP push) or manual (Procurement Admin downloads and uploads into the ERP)? If automated, does a return channel exist for the ERP to confirm the PO number back to this system?
8. Is digital signature / e-signing mandatory for E-Tender Approval or L1 Approval records, and if so, which provider is already licensed by the hospital?
9. Data retention period required for statutory audit compliance (confirm with hospital's audit/compliance team).
