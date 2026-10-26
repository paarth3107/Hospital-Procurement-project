"""THE seed script -- the single source of a working local dev database.
2026-10-24: replaces both the old app/seed.py (facilities/staff/approval
bands/override configs only) and app/seed_demo.py (an earlier, smaller
vendor/mapping/rating/tender demo) -- both removed once this file (briefly
named app/seed_ui_design.py mid-transition, renamed back to app/seed.py once
it became the one script) covered everything they did and more; nothing else
in this repo creates seed data. Fills the database with realistic sample
data for the Vendor Panel and Category Manager screens, including enough
backdated ("grandfather") history that every downstream-dependent feature
has something real to show, not just the handful of
records visible today.

What it creates (all dates are relative to the moment you run it):
  * The facility + one demo staff login per role, plus two more facilities
    with their own scoped staff (former app/seed.py's DEMO_STAFF/
    DEMO_FACILITIES/DEMO_FACILITY_STAFF, unchanged), the illustrative
    approval bands (spec 11.2) and override type configs (spec 12.3)
  * 10 categories, 16 sub-categories, 28 products (Items, Assets, Services)
  * 5 vendors (V-1..V-5): 3 Active, 1 Suspended, 1 Pending verification,
    each with KYC documents and a real status-transition history (walked
    through set_status() exactly as the live app would, not hand-inserted)
  * Vendor mappings: category-level and item-level, approved / pending /
    rejected, with history (via the real log_transition() helper)
  * 4 GRANDFATHER tenders (2-9 months ago, closed/awarded, invisible
    clutter in the main list by design) whose bids are run through the
    real technical-evaluation + price-competitiveness pipeline
    (_update_price_competitiveness / refresh_price_competitiveness) so
    Price Competitiveness is a REAL computed score backed by real
    PriceCompetitivenessRecord rows, not a hand-typed number. This is the
    one correction that actually matters: the previous draft hardcoded
    price_competitiveness=50 directly, which this app's rating redesign
    specifically treats as "no real evidence" territory -- a fabricated
    score here would make every vendor with any manual entry look
    falsely "rated" instead of genuinely Unrated.
  * 9 current tenders (ids 1, 34, 41, 42, 43, 46, 47, 48, 49) covering
    open bidding, drafts, submitted bids, evaluation, awarded and no-award,
    plus a tender-line vendor exclusion and tender-line/bid attachments
    (SOW documents for Service lines, spec sheets, datasheets)
  * Bids, technical evaluations, award rounds and PO data files for #34
  * Manual rating entries for the 4 Category-Manager-owned sub-scores, each
    going through the exact same RatingHistory + audit-log shape
    routers/ratings.py's real PATCH endpoint produces, plus 1-2 earlier
    backdated entries per vendor so the History tab shows a real
    progression, not a single flat entry
  * Override requests for the Decisions page (pending, via create_override;
    history, via the real approve_override/reject_override, which also
    produces the StaffNotification rows a real decision would)
  * Vendor notifications

SAFETY:
  * It deletes EVERY business-data table before seeding -- vendors, catalog,
    tenders, bids, awards, PO files, overrides, notifications, audit log,
    AND NOW ALSO facilities, staff logins, approval bands and override
    configs (no KEEP_TABLES carve-out anymore -- this script owns recreating
    all of it, start to finish, not just layering on top of app.seed). It
    refuses to run on a database that already has vendors or tenders unless
    you pass --wipe. Never run it against a shared/production database.
  * This script calls the REAL set_status()/notify_vendor() code paths for
    vendor status transitions (so the audit log and vendor notification
    inbox are populated for real, not faked) -- confirmed safe: the kinds
    set_status() ever fires ("vendor_active", "vendor_suspended", ...) are
    NOT in notifier.py's EMAIL_ENABLED_KINDS, so no real email goes out
    from that path regardless of SMTP config. The "awarded"/"invited"
    vendor-portal notifications below are written as plain Notification
    rows directly (same as before), not through notify_vendor(), so they
    can't trigger an email either. Still: if this is ever pointed at an
    environment with real SMTP configured and real vendor email addresses,
    double check email_adapter.py's backend before running.

Run from the backend folder:
    venv/bin/python -m app.seed --wipe        (if placed in app/)
    venv/bin/python path/to/seed.py --wipe    (from anywhere else)

Logins afterwards:
    Category manager  category@medsource.local / changeme123
    Vendor (MedEquip) rohan@medequipsolutions.co / vendor12345
    Other vendors     <email below> / vendor12345
"""

import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.getcwd())

from sqlalchemy import text  # noqa: E402

from app import models  # noqa: E402,F401  (registers every table on Base.metadata)
from app.database import Base, SessionLocal  # noqa: E402
from app.models.approval_band import ApprovalBand  # noqa: E402
from app.models.award import AwardAllocation, AwardRound, Notification  # noqa: E402
from app.models.bid import Bid, BidAttachment, BidAttachmentKind, BidStatus  # noqa: E402
from app.models.bid_evaluation import BidEvaluation, BidTechnicalResult, TechnicalDecision  # noqa: E402
from app.models.facility import Facility  # noqa: E402
from app.models.override import OverrideStatus, OverrideType, OverrideTypeConfig  # noqa: E402
from app.models.product_master import ProcurementType, ProductCategory, ProductMaster, ProductSubCategory  # noqa: E402
from app.models.staff_notification import StaffNotification  # noqa: E402
from app.models.tender import Tender, TenderStatus, TenderType  # noqa: E402
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound  # noqa: E402
from app.models.tender_attachment import TenderLineAttachment, TenderLineAttachmentKind  # noqa: E402
from app.models.tender_invite import TenderInvite  # noqa: E402
from app.models.tender_line_exclusion import TenderLineExclusion  # noqa: E402
from app.models.tender_line_item import TenderLineItem  # noqa: E402
from app.models.user_account import Role, UserAccount  # noqa: E402
from app.models.vendor import DocumentStatus, Vendor, VendorDocType, VendorDocument, VendorStatus, VendorStatusHistory  # noqa: E402
from app.models.vendor_mapping import MappingState, VendorMapping, VendorMappingHistory  # noqa: E402
from app.models.vendor_rating import MATERIAL_CHANGE_THRESHOLD, PriceCompetitivenessRecord, RatingHistory, VendorRating  # noqa: E402
from app.routers.evaluation import _update_price_competitiveness  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services.audit import record  # noqa: E402
from app.services.mappings import log_transition  # noqa: E402
from app.services.overrides import DEFAULT_SLA_HOURS, approve_override, create_override, reject_override  # noqa: E402
from app.services.po_files import generate_for_tender  # noqa: E402
from app.services.ratings import get_or_create_rating  # noqa: E402
from app.services.vendor_status import set_status  # noqa: E402

VENDOR_PASSWORD = "vendor12345"

NOW = datetime.now(timezone.utc).replace(microsecond=0)
TODAY = date.today()


def ago(days=0, hours=0, minutes=0):
    return NOW - timedelta(days=days, hours=hours, minutes=minutes)


def ahead(days=0, hours=0, minutes=0):
    return NOW + timedelta(days=days, hours=hours, minutes=minutes)


def pdf_bytes(title: str) -> bytes:
    """A tiny but valid one-page PDF, so document previews open."""
    stream = f"BT /F1 18 Tf 72 720 Td ({title}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{off:010d} 00000 n \n".encode() for off in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def attachment_bytes(title: str) -> bytes:
    return pdf_bytes(title)


# --------------------------------------------------------------------------- base config
# Everything in this section is former app/seed.py content, unchanged, now
# created directly here instead of by calling out to that (now removed)
# script -- see the module docstring.

# One demo login per staff role, so the role-scoped nav
# (frontend/src/lib/constants.ts's ROLE_TABS) can actually be clicked through
# locally instead of only ever being tested as one account. All of these are
# scoped to the first (default) facility. `sysadmin@medsource.local` is the
# canonical admin login.
DEMO_STAFF = [
    ("officer@medsource.local", "changeme123", "Priya Sharma", Role.PROCUREMENT_OFFICER, None),
    ("category@medsource.local", "changeme123", "Ravi Kumar", Role.CATEGORY_MANAGER, None),
    ("authority1@medsource.local", "changeme123", "Dr. Anjali Rao", Role.APPROVING_AUTHORITY, 1),
    ("authority3@medsource.local", "changeme123", "Dr. Vikram Singh", Role.APPROVING_AUTHORITY, 3),
    ("sysadmin@medsource.local", "changeme123", "Sanjay Gupta", Role.SYSTEM_ADMIN, None),
]

# Spec §2.3: multi-facility from the start. Two more facilities plus staff
# scoped to each, so the Staff Accounts facility picker (System Admin) has
# something real to switch between locally instead of one facility only.
DEMO_FACILITIES = [
    ("Eastside Community Hospital", "ECH-002"),
    ("Lakeview Specialty Clinic", "LSC-003"),
]

# (email, password, full_name, role, approval_tier, facility_code | None for group-wide)
DEMO_FACILITY_STAFF = [
    ("officer2@medsource.local", "changeme123", "Meena Pillai", Role.PROCUREMENT_OFFICER, None, "ECH-002"),
    ("category2@medsource.local", "changeme123", "Arjun Nair", Role.CATEGORY_MANAGER, None, "ECH-002"),
    ("authority2@medsource.local", "changeme123", "Dr. Farah Khan", Role.APPROVING_AUTHORITY, 2, "ECH-002"),
    ("admin3@medsource.local", "changeme123", "Karan Mehta", Role.CATEGORY_MANAGER, None, "LSC-003"),
    ("officer3@medsource.local", "changeme123", "Sunita Verma", Role.PROCUREMENT_OFFICER, None, "LSC-003"),
    # facility_code None -- a group-wide login, so the "All facilities" case shows under every facility filter too.
    ("groupadmin@medsource.local", "changeme123", "Deepak Joshi", Role.SYSTEM_ADMIN, None, None),
]

# Spec §11.2's illustrative value bands (CLAUDE.md open question 2 — bands
# and roles still to be finalized against actual hospital delegation-of-
# authority policy). Seeded as data, not hardcoded in application logic, so
# a hospital can reconfigure these without a code change.
DEFAULT_APPROVAL_BANDS = [
    {"min_value": 0.0, "max_value": 100_000.0, "tier": 1, "label": "Approving Authority (tier 1)"},
    {"min_value": 100_000.0, "max_value": 1_000_000.0, "tier": 2, "label": "Department Head"},
    {"min_value": 1_000_000.0, "max_value": None, "tier": 3, "label": "Department Head + Finance/Management Committee"},
]

# Spec §12.3's table, as hospital-configurable data. Thresholds are
# illustrative starting points -- trigger_value's meaning is per-type.
DEFAULT_OVERRIDE_CONFIGS = [
    {
        "override_type": OverrideType.PRICE_COMPETITIVENESS_OVERRIDE,
        "default_approver_role": Role.CATEGORY_MANAGER,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
        "escalation_threshold": 15.0,  # score-point range the adjustment must not exceed
    },
    {
        "override_type": OverrideType.INVITE_LIST_MANUAL_ADD,
        "default_approver_role": Role.CATEGORY_MANAGER,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
        "escalation_threshold": 200_000.0,  # cumulative override value on the tender
    },
    {
        "override_type": OverrideType.GUEST_VENDOR_INVITE,
        "default_approver_role": Role.PROCUREMENT_OFFICER, "self_attested": True,
        "escalate_to_role": Role.CATEGORY_MANAGER,
        "escalation_threshold": 3.0,  # guest count per tender
    },
    {
        "override_type": OverrideType.TECHNICAL_SCORE_CORRECTION,
        "default_approver_role": Role.CATEGORY_MANAGER,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
    },
    {
        "override_type": OverrideType.LATE_SUBMISSION_EXCEPTION,
        "default_approver_role": Role.CATEGORY_MANAGER,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
        "escalation_threshold": 1_000_000.0,  # tender value
    },
    {
        "override_type": OverrideType.DUE_DATE_EXTENSION,
        "default_approver_role": Role.PROCUREMENT_OFFICER, "self_attested": True,
        "escalate_to_role": Role.CATEGORY_MANAGER,
        "escalation_threshold": 7.0,  # cumulative extension days requested
    },
    {
        "override_type": OverrideType.NON_L1_AWARD_OVERRIDE,
        "default_approver_role": Role.CATEGORY_MANAGER,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 3,
        "escalation_threshold": 1_000_000.0,  # award value
    },
    {
        "override_type": OverrideType.PO_REEXPORT,
        "default_approver_role": Role.CATEGORY_MANAGER,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
    },
]

# --------------------------------------------------------------------------- catalog
I, A, S = ProcurementType.ITEM, ProcurementType.ASSET, ProcurementType.SERVICE

# name, type, min rating, required documents, {sub-category: [(code, name, uom, price_min, price_max, min_rating)]}
CATALOG = [
    ("Consumables", I, None, [], {
        "General Supplies": [("MED-BANDAGE-001", "Cotton Bandage Rolls", "Pack of 12", 60, 110, None),
                             ("MED-SYRINGE-001", "Disposable Syringes (10 ml)", "Box of 100", 450, 700, None)],
        "Implants": [("IMPL-HIP-001", "Total Hip Implant (Cemented)", "Each", 85000, 140000, None),
                     ("IMPL-KNEE-001", "Total Knee Implant", "Each", 90000, 160000, None),
                     ("IMPL-STENT-001", "Drug-Eluting Coronary Stent", "Each", 22000, 38000, 80)],
        "PPE": [("SURG-GLOVES-001", "Surgical Gloves (Latex, Size M)", "Box of 100", 600, 1200, None),
                ("SURG-GOWN-001", "Surgical Gowns (Sterile, Disposable)", "Each", 180, 320, None),
                ("SURG-MASK-001", "Surgical Masks (3-ply)", "Box of 50", 100, 250, None)],
    }),
    ("Pharmaceuticals", I, 70, ["drug_license"], {
        "Analgesics": [("PHARMA-PARA-001", "Paracetamol 650 mg Tablets", "Strip of 15", 18, 30, None),
                       ("PHARMA-IBU-001", "Ibuprofen 400 mg Tablets", "Strip of 10", 12, 22, None),
                       ("PHARMA-DICLO-001", "Diclofenac Gel 30 g", "Tube", 60, 110, None)],
        "Antibiotics": [("PHARMA-AMOX-001", "Amoxicillin 500 mg Capsules", "Strip of 10", 60, 95, None),
                        ("PHARMA-AZI-001", "Azithromycin 500 mg Tablets", "Strip of 3", 70, 120, None),
                        ("PHARMA-CEF-001", "Ceftriaxone 1 g Injection", "Vial", 45, 80, None)],
    }),
    ("Lab Reagents", I, None, [], {
        "Biochemistry": [("QA-LAB-001", "Glucose Reagent Kit", "Kit", 1800, 2600, None)],
        "Haematology": [("QA-LAB-002", "CBC Diluent", "Bottle (20 L)", 1500, 2200, None)],
    }),
    ("Imaging Equipment", A, None, ["iso_certificate"], {
        "Radiology": [("XRAY-MACH-001", "Digital X-Ray Machine", "Unit", 1800000, 3500000, None),
                      ("USG-SCAN-001", "Ultrasound Scanner", "Unit", 900000, 2200000, None)],
    }),
    ("Patient Care Equipment", A, None, [], {
        "Critical Care": [("ICU-BED-001", "ICU Bed with Electric Adjustment", "Unit", 120000, 260000, None),
                          ("PT-MONITOR-001", "Multi-Parameter Patient Monitor", "Unit", 85000, 180000, None)],
    }),
    ("IT Equipment", A, 60, [], {
        "Computing": [("IT-DESKTOP-001", "Desktop Workstation", "Unit", 45000, 75000, None),
                      ("IT-LAPTOP-001", "Laptop (i5, 16 GB)", "Unit", 55000, 85000, None)],
        "Networking": [("IT-SWITCH-001", "Network Switch (24-port)", "Unit", 18000, 42000, None)],
    }),
    ("OT Equipment", A, None, [], {
        "Operating Tables": [("QA-OT-001", "OT Table (electro-hydraulic)", "Unit", 600000, 950000, None)],
    }),
    ("Facility Services", S, 65, ["other:Housekeeping licence"], {
        "Housekeeping": [("HKEEP-SVC-001", "Housekeeping & Sanitation", "Month", 180000, 320000, None)],
        "Security": [("SEC-GUARD-001", "Security Guard Service", "Guard-month", 18000, 28000, None)],
    }),
    ("IT Services", S, None, [], {
        "AMC": [("BIOMED-AMC-001", "Biomedical Equipment AMC", "Year", 250000, 600000, None)],
    }),
    ("Linen Services", S, None, [], {
        "Laundry": [("QA-SVC-001", "Linen Laundry Service", "kg", 18, 32, None)],
    }),
]

TYPE_ATTRS = {
    I: {"shelf_life_months": 24, "storage": "Below 30 °C"},
    A: {"warranty_months": 24, "certifications": ["BIS"]},
    S: {"sla": "Response within 4 hours", "scope_of_work": "As per attached SOW"},
}

# --------------------------------------------------------------------------- vendors
VENDORS = [
    dict(id=1, status=VendorStatus.ACTIVE, legal_name="MedEquip Solutions Pvt Ltd", trade_name="MedEquip", entity_type="Private Limited",
         gstin="27AAAPM1234C1Z5", pan="AAAPM1234C", year_of_incorporation=2004,
         registered_address="Unit 7, Marol MIDC, Andheri East", city="Mumbai", state="Maharashtra", pincode="400093",
         branch_locations="Pune, Ahmedabad", bank_name="HDFC Bank", bank_account_number="50100123453456", bank_ifsc="HDFC0000234",
         contact_person="Rohan Mehta", contact_designation="Sales Director", email="rohan@medequipsolutions.co", phone="9820011122",
         escalation_contact_name="Meera Shah", escalation_contact_phone="9820099887", escalation_contact_email="meera@medequipsolutions.co",
         payment_terms="45 days from GRN", delivery_lead_time_days=10, min_order_value=25000,
         category_declaration="Consumables,Lab Reagents,Patient Care Equipment,OT Equipment,Linen Services"),
    dict(id=2, status=VendorStatus.SUSPENDED, legal_name="SurgiCare Supplies Ltd", trade_name="SurgiCare", entity_type="Public Limited",
         gstin="29AACCS5678K1Z2", pan="AACCS5678K", year_of_incorporation=2009,
         registered_address="42, Peenya Industrial Area, Phase 2", city="Bengaluru", state="Karnataka", pincode="560058",
         bank_name="Axis Bank", bank_account_number="917020045678123", bank_ifsc="UTIB0000456",
         contact_person="Kavita Nair", contact_designation="Key Accounts Manager", email="kavita@surgicaresupplies.co", phone="9845012345",
         payment_terms="30 days from GRN", delivery_lead_time_days=14, min_order_value=50000,
         category_declaration="Lab Reagents,OT Equipment,Linen Services,Imaging Equipment",
         rejection_reason="Repeated late delivery: 3 of the last 5 POs delivered late"),
    dict(id=3, status=VendorStatus.ACTIVE, legal_name="PharmaLink Distributors", trade_name="PharmaLink", entity_type="Partnership",
         gstin="19AAKFP4321M1Z8", pan="AAKFP4321M", year_of_incorporation=2012,
         registered_address="18, Strand Road, Burrabazar", city="Kolkata", state="West Bengal", pincode="700001",
         bank_name="State Bank of India", bank_account_number="38475610293", bank_ifsc="SBIN0001234",
         contact_person="Suresh Iyer", contact_designation="Director", email="suresh@pharmalink.co", phone="9830056789",
         payment_terms="60 days from GRN", delivery_lead_time_days=7, min_order_value=15000,
         category_declaration="Consumables,Lab Reagents,Pharmaceuticals"),
    dict(id=4, status=VendorStatus.ACTIVE, legal_name="CleanTech Hospital Services", trade_name="CleanTech", entity_type="Private Limited",
         gstin="07AADCC9876H1Z4", pan="AADCC9876H", year_of_incorporation=2015,
         registered_address="B-14, Okhla Industrial Area, Phase 1", city="New Delhi", state="Delhi", pincode="110020",
         bank_name="ICICI Bank", bank_account_number="002105012345", bank_ifsc="ICIC0000021",
         contact_person="Anita Desai", contact_designation="Business Head", email="anita@cleantechhs.co", phone="9810098765",
         payment_terms="30 days from invoice", delivery_lead_time_days=5, min_order_value=10000,
         category_declaration="Lab Reagents,OT Equipment,Linen Services,Facility Services"),
    dict(id=5, status=VendorStatus.PENDING_VERIFICATION, legal_name="NextGen Diagnostics Pvt Ltd", trade_name="NextGen", entity_type="Private Limited",
         gstin="36AAGCN2468P1Z6", pan="AAGCN2468P", year_of_incorporation=2021,
         registered_address="Plot 9, Genome Valley, Shamirpet", city="Hyderabad", state="Telangana", pincode="500078",
         bank_name="Kotak Mahindra Bank", bank_account_number="7412589630", bank_ifsc="KKBK0007123",
         contact_person="Vikram Rao", contact_designation="Founder", email="vikram@nextgendiagnostics.co", phone="9849012233",
         category_declaration="Lab Reagents,Consumables"),
]

MANDATORY = ["gst_certificate", "pan_card", "incorporation_certificate", "bank_proof", "sample_catalog"]

# vendor id -> [(doc_type, status, valid_till, custom_label)]
DOCS = {
    1: [(d, "verified", None, "") for d in MANDATORY] + [
        ("drug_license", "verified", TODAY + timedelta(days=18), ""),
        ("msme_udyam", "pending", None, ""),
        ("business_license", "verified", date(2027, 6, 20), ""),
        ("iso_certificate", "verified", date(2027, 12, 7), ""),
    ],
    2: [(d, "verified", None, "") for d in MANDATORY] + [("iso_certificate", "verified", date(2027, 3, 31), "")],
    3: [(d, "verified", None, "") for d in MANDATORY] + [("drug_license", "verified", date(2028, 1, 15), "")],
    4: [(d, "verified", None, "") for d in MANDATORY] + [("other", "verified", date(2027, 9, 30), "Housekeeping licence")],
    5: [(d, "pending", None, "") for d in MANDATORY],
}

# vendor id -> {type: (on_time, quality, compliance, responsiveness)} -- price_competitiveness
# is deliberately NOT here anymore: it's computed for real from grandfather bid
# history below (GRANDFATHER_TENDERS), via the same _update_price_competitiveness/
# refresh_price_competitiveness pipeline the live app uses. A vendor absent from
# a given procurement type here (and with no grandfather bids for that type
# either) simply has no VendorRating row for it -- correctly Unrated, the same
# way a brand-new vendor would be, rather than a hand-typed "all None" tuple.
RATINGS = {
    1: {I: (90, 88, 95, 85), A: (90, 88, 95, 85), S: (70, 68, 75, 65)},
    2: {I: (75, 80, 70, 78), A: (75, 80, 70, 78), S: (75, 80, 70, 78)},
    3: {I: (60, 65, 72, 68)},
    4: {I: (80, 77, 75, 76), A: (95, 92, 90, 91), S: (95, 92, 90, 91)},
    # vendor 5 (Pending verification): no manual entries at all -- nothing to
    # enter yet for a vendor that's never been engaged.
}

# An earlier, somewhat different manual entry per vendor/type/field, so the
# Ratings page's History tab shows a real progression leading up to RATINGS'
# "current" values above, instead of one flat entry with no story behind it.
# (vendor id, type, field) -> (earlier_value, days_ago)
RATING_HISTORY_DEPTH = {
    (1, I, "on_time_pct"): (82, 70), (1, I, "quality_pct"): (84, 70),
    (1, S, "on_time_pct"): (60, 55), (1, S, "quality_pct"): (62, 55),
    (2, I, "on_time_pct"): (85, 90), (2, I, "quality_pct"): (86, 90),  # SurgiCare used to be better -- the decline is the point
    (4, A, "on_time_pct"): (88, 60), (4, A, "quality_pct"): (85, 60),
}

# (vendor id, "cat:<name>" | "item:<code>", state, requested days ago, reason)
MAPPINGS = [
    (1, "cat:Consumables", "approved", 9, None),
    (1, "cat:Lab Reagents", "approved", 9, None),
    (1, "cat:Patient Care Equipment", "approved", 8, None),
    (1, "cat:OT Equipment", "approved", 8, None),
    (1, "cat:Linen Services", "approved", 8, None),
    (1, "item:PHARMA-PARA-001", "approved", 6, None),
    (1, "item:PHARMA-AMOX-001", "pending", 1, None),
    (1, "item:XRAY-MACH-001", "pending", 1, None),
    (1, "item:USG-SCAN-001", "pending", 1, None),
    (1, "item:HKEEP-SVC-001", "rejected", 3, "Housekeeping licence not on file"),
    (2, "cat:Lab Reagents", "approved", 12, None),
    (2, "cat:OT Equipment", "approved", 12, None),
    (2, "cat:Linen Services", "approved", 12, None),
    (2, "item:XRAY-MACH-001", "approved", 12, None),
    (3, "cat:Consumables", "approved", 10, None),
    (3, "cat:Lab Reagents", "approved", 10, None),
    (3, "item:ICU-BED-001", "approved", 10, None),
    (3, "item:IMPL-STENT-001", "pending", 2, None),
    (4, "cat:Lab Reagents", "approved", 11, None),
    (4, "cat:OT Equipment", "approved", 11, None),
    (4, "cat:Linen Services", "approved", 11, None),
    (4, "item:HKEEP-SVC-001", "approved", 11, None),
    (5, "cat:Consumables", "pending", 2, None),
]

# --------------------------------------------------------------------------- grandfather price history
# Historical, already-closed tenders whose ONLY purpose is to give
# price_competitiveness something real to be computed from (spec 5.2/5.3: the
# only auto-computed sub-score, derived from this system's own bid history).
# Deliberately NOT run through award-round/PO-file machinery -- that paperwork
# adds nothing to what these exist for, and these are old enough that it's
# entirely plausible nobody ever re-opens them. Each needs >= 2 technically
# qualified bids on the SAME line (_update_price_competitiveness's own rule --
# an unopposed bid isn't "competitive"), so every entry below picks a product
# at least two Active vendors both declared a category for.
# (title, product code, months ago, [(vendor id, unit price, gst%)])
GRANDFATHER_TENDERS = [
    ("Lab Reagents – Annual Rate Contract (archived)", "QA-LAB-001", 9, [(1, 2150, 12), (2, 2380, 12), (3, 2260, 12), (4, 2300, 12)]),
    ("Surgical Consumables – Q1 Supply (archived)", "MED-SYRINGE-001", 6, [(1, 590, 12), (3, 640, 12)]),
    ("OT Table Replacement (archived)", "QA-OT-001", 4, [(1, 780000, 18), (2, 820000, 18), (4, 795000, 18)]),
    ("Linen Laundry – Prior Year Contract (archived)", "QA-SVC-001", 2, [(1, 24, 18), (2, 27, 18), (4, 22, 18)]),
]

# --------------------------------------------------------------------------- tenders
# id, title, type, status, department, due (datetime), rate contract, lines [(code, qty, est price)]
TENDERS = [
    (46, "Annual Rate Contract – Surgical Consumables FY26-27", TenderType.RFQ, TenderStatus.PUBLISHED, "Central Stores", ahead(1, 14, 32), True,
     [("SURG-GLOVES-001", 20000, 900), ("MED-SYRINGE-001", 50000, 600), ("SURG-MASK-001", 80000, 180), ("SURG-GOWN-001", 6000, 250), ("MED-BANDAGE-001", 12000, 85)]),
    (48, "Laboratory Reagents – Q3 Supply", TenderType.RFQ, TenderStatus.PUBLISHED, "Laboratory", ahead(4, 5), False,
     [("QA-LAB-001", 400, 2200), ("QA-LAB-002", 250, 1850)]),
    (49, "OPD Linen Laundry – 12 Month Contract", TenderType.RFQ, TenderStatus.PUBLISHED, "Housekeeping", ahead(8, 5), False,
     [("QA-SVC-001", 24000, 26)]),
    (42, "Glucose Reagent Kit – Top-up Order", TenderType.RFQ, TenderStatus.PUBLISHED, "Laboratory", ahead(9, 7), False,
     [("QA-LAB-001", 25, 2200)]),
    (47, "ICU Upgrade – Patient Monitors & ICU Beds", TenderType.RFP, TenderStatus.PUBLISHED, "Critical Care", ahead(12, 5), False,
     [("PT-MONITOR-001", 12, 140000), ("ICU-BED-001", 8, 190000)]),
    (1, "Supply of Surgical Gloves – FY26 Q1", TenderType.RFQ, TenderStatus.PUBLISHED, "OT", ahead(13, 7), False,
     [("SURG-GLOVES-001", 500, 900)]),
    (41, "Glucose Reagent Kit – Urgent Requirement", TenderType.RFQ, TenderStatus.PUBLISHED, "Laboratory", ago(1, 2), False,
     [("QA-LAB-001", 10, 2200)]),
    (34, "OPD Expansion – Reagents, OT Table & Laundry", TenderType.RFP, TenderStatus.AWARDED, "OPD", ago(4), False,
     [("QA-SVC-001", 1500, 26), ("QA-LAB-001", 50, 2200), ("QA-OT-001", 1, 800000)]),
    (43, "Bandage Rolls – Spot Purchase", TenderType.RFQ, TenderStatus.NO_AWARD, "Central Stores", ago(6), False,
     [("MED-BANDAGE-001", 200, 85)]),
]

# tender id -> {line index: [vendor ids invited]}
INVITES = {
    46: {i: [1, 3] for i in range(5)},
    48: {0: [1, 3, 4], 1: [1, 3, 4]},
    49: {0: [1, 4]},
    42: {0: [1, 3, 4]},
    47: {0: [1], 1: [1, 3]},
    1: {0: [1, 3]},
    41: {0: [1, 3, 4]},
    34: {0: [1, 4], 1: [1, 3, 4], 2: [1, 4]},
    43: {0: [1, 3]},
}

# Officer manually removed this vendor from this specific line -- distinct
# from a vendor-wide suspension (that's VendorStatus, already covers vendor 2
# everywhere); this is "otherwise-eligible vendor, excluded from just this
# one line, for a line-specific reason," so it holds even if the vendor stays
# perfectly fine everywhere else. (tender id, line index, vendor id, reason)
EXCLUSIONS = [
    (46, 2, 3, "Quality concern raised on PharmaLink's last PPE delivery (PO-2031) -- excluded from masks pending resolution"),
]
_EXCLUDED_PAIRS = {(tid, idx, vid) for tid, idx, vid, _ in EXCLUSIONS}

# Lines that need a mandatory SOW (every Service line) or benefit from a
# spec sheet/datasheet attached at tender-creation time, spec 6.4.
# (tender id, line index, kind, filename title)
LINE_ATTACHMENTS = [
    (49, 0, TenderLineAttachmentKind.SOW_DOCUMENT, "Linen Laundry SOW"),
    (34, 0, TenderLineAttachmentKind.SOW_DOCUMENT, "Linen Laundry SOW (OPD Expansion)"),
    (47, 0, TenderLineAttachmentKind.TECHNICAL_SPEC_SHEET, "Patient Monitor Technical Spec"),
    (47, 1, TenderLineAttachmentKind.TECHNICAL_SPEC_SHEET, "ICU Bed Technical Spec"),
]

# (tender id, line index, vendor id, status, unit price, gst %, lead days, validity days, brand, submitted days ago)
BIDS = [
    (46, 0, 1, BidStatus.DRAFT, 840, 12, 7, 90, "Supermax", None),
    (46, 1, 1, BidStatus.DRAFT, 560, 12, 7, 90, "Dispovan", None),
    (48, 0, 1, BidStatus.SUBMITTED, 2050, 12, 4, 90, "Erba", 0.5),
    (48, 1, 1, BidStatus.SUBMITTED, 1720, 12, 4, 90, "Sysmex", 0.5),
    (41, 0, 4, BidStatus.SUBMITTED, 1950, 12, 5, 60, "Erba", 1.1),
    (41, 0, 1, BidStatus.SUBMITTED, 1800, 12, 4, 60, "Erba", 1.05),
    (34, 0, 1, BidStatus.SUBMITTED, 24, 18, 3, 365, None, 5),
    (34, 0, 4, BidStatus.SUBMITTED, 27, 18, 2, 365, None, 5),
    (34, 1, 1, BidStatus.SUBMITTED, 2100, 12, 4, 90, "Erba", 5),
    (34, 1, 3, BidStatus.SUBMITTED, 2350, 12, 6, 90, "Transasia", 5),
    (34, 2, 1, BidStatus.SUBMITTED, 720000, 18, 30, 90, "Mindray", 5),
    (34, 2, 4, BidStatus.SUBMITTED, 760000, 18, 21, 90, "Mindray", 5),
]
# tender 34: line index -> winning vendor id
AWARDS_34 = {0: 1, 1: 1, 2: 4}

# A few bids get a document attached (spec 8.3) -- not every bid needs one for
# a seed, just enough that the Attachments section isn't uniformly empty.
# (tender id, line index, vendor id, kind, filename title)
BID_ATTACHMENTS = [
    (41, 0, 1, BidAttachmentKind.DATASHEET, "Glucose Reagent Kit Datasheet"),
    (41, 0, 4, BidAttachmentKind.DATASHEET, "Glucose Reagent Kit Datasheet"),
    (34, 0, 1, BidAttachmentKind.SOW_METHOD, "Laundry Method Statement"),
    (34, 0, 4, BidAttachmentKind.SOW_METHOD, "Laundry Method Statement"),
]


def wipe(db):
    dialect = db.bind.dialect.name
    tables = list(reversed(Base.metadata.sorted_tables))
    if dialect == "mysql":
        db.execute(text("SET FOREIGN_KEY_CHECKS=0"))
    for t in tables:
        db.execute(t.delete())
    if dialect == "mysql":
        db.execute(text("SET FOREIGN_KEY_CHECKS=1"))
    db.commit()
    print(f"Wiped {len(tables)} tables")


def _attach_to_line(db, line_item_id, kind, title, uploader_id):
    content = attachment_bytes(title)
    db.add(TenderLineAttachment(
        tender_line_item_id=line_item_id, kind=kind, original_filename=title.lower().replace(" ", "_") + ".pdf",
        content_type="application/pdf", size_bytes=len(content), content=content, uploaded_by_id=uploader_id,
    ))


def _attach_to_bid(db, bid_id, kind, title):
    content = attachment_bytes(title)
    db.add(BidAttachment(
        bid_id=bid_id, kind=kind, original_filename=title.lower().replace(" ", "_") + ".pdf",
        content_type="application/pdf", size_bytes=len(content), content=content,
    ))


def run(allow_wipe: bool):
    db = SessionLocal()
    try:
        if (db.query(Vendor).count() or db.query(Tender).count()) and not allow_wipe:
            print("This database already has vendors or tenders. Re-run with --wipe to replace ALL business data.")
            return
        wipe(db)

        # ---- base config: facility, staff, approval bands, override configs
        # (former app/seed.py content -- see module docstring)
        facility = Facility(name="City Central Hospital", legal_entity_code="CCH-001")
        db.add(facility)
        db.flush()

        staff = {}
        for email, password, full_name, role, approval_tier in DEMO_STAFF:
            u = UserAccount(email=email, hashed_password=hash_password(password), full_name=full_name,
                            role=role, facility_id=facility.id, approval_tier=approval_tier)
            db.add(u)
            staff[email] = u
        db.flush()
        officer, cm, auth1, auth3 = (staff[e] for e in
                                     ("officer@medsource.local", "category@medsource.local", "authority1@medsource.local", "authority3@medsource.local"))

        facility_by_code = {facility.legal_entity_code: facility}
        for name, code in DEMO_FACILITIES:
            f = Facility(name=name, legal_entity_code=code)
            db.add(f)
            db.flush()
            facility_by_code[code] = f

        for email, password, full_name, role, approval_tier, facility_code in DEMO_FACILITY_STAFF:
            db.add(UserAccount(email=email, hashed_password=hash_password(password), full_name=full_name, role=role,
                               facility_id=facility_by_code[facility_code].id if facility_code else None, approval_tier=approval_tier))

        for band in DEFAULT_APPROVAL_BANDS:
            db.add(ApprovalBand(facility_id=None, **band))
        for config in DEFAULT_OVERRIDE_CONFIGS:
            db.add(OverrideTypeConfig(sla_hours=DEFAULT_SLA_HOURS, **config))
        db.flush()
        print(f"Base config: facility + {len(DEMO_STAFF)} staff logins, {len(DEMO_FACILITIES)} more facilities + {len(DEMO_FACILITY_STAFF)} staff, "
              f"{len(DEFAULT_APPROVAL_BANDS)} approval bands, {len(DEFAULT_OVERRIDE_CONFIGS)} override configs")

        # ---- catalog
        cats, products = {}, {}
        for cname, ptype, min_r, docs, subs in CATALOG:
            c = ProductCategory(name=cname, procurement_type=ptype, min_mapping_rating=min_r, required_documents=docs, created_at=ago(30))
            db.add(c)
            db.flush()
            cats[cname] = c
            for sname, items in subs.items():
                sc = ProductSubCategory(name=sname, category_id=c.id, created_at=ago(30))
                db.add(sc)
                db.flush()
                for code, name, uom, pmin, pmax, prod_min in items:
                    p = ProductMaster(
                        code=code, name=name, procurement_type=ptype, category_id=c.id, sub_category_id=sc.id,
                        unit_of_measure=uom, price_band_min=pmin, price_band_max=pmax, min_mapping_rating=prod_min,
                        required_documents=[], approved_brands=[], type_specific_attrs=TYPE_ATTRS[ptype], created_at=ago(30),
                    )
                    db.add(p)
                    products[code] = p
        db.flush()
        print(f"Catalog: {len(cats)} categories, {db.query(ProductSubCategory).count()} sub-categories, {len(products)} products")

        # ---- vendors: constructed at the real default (PENDING_VERIFICATION),
        # then walked through the exact real registration-history insert + the
        # real set_status() for every further transition, so VendorStatusHistory,
        # the audit log, and the vendor's own notification inbox all end up
        # exactly as they would from real use -- not a parallel hand-built copy
        # of what those functions already do.
        vendors = {}
        pw = hash_password(VENDOR_PASSWORD)
        for spec in VENDORS:
            target_status = spec.pop("status")
            v = Vendor(**spec, hashed_password=pw, email_verified_at=ago(40), created_at=ago(40 - spec["id"]))
            db.add(v)
            db.flush()
            db.add(VendorStatusHistory(vendor_id=v.id, from_status=None, to_status=VendorStatus.PENDING_VERIFICATION, reason="Registered", at=ago(40 - spec["id"])))
            vendors[spec["id"]] = v
            spec["status"] = target_status  # restore for anything reading VENDORS again below
        db.flush()
        for vid, v in vendors.items():
            target = VENDORS[vid - 1]["status"]
            if target in (VendorStatus.ACTIVE, VendorStatus.SUSPENDED):
                set_status(db, v, VendorStatus.ACTIVE, cm.id, "All mandatory documents verified")
            if target == VendorStatus.SUSPENDED:
                set_status(db, v, VendorStatus.SUSPENDED, cm.id, v.rejection_reason)
            # Backdate -- set_status always timestamps "now"; these are meant to
            # read as having happened weeks ago, same as the rest of this vendor's history.
            for h in db.query(VendorStatusHistory).filter(VendorStatusHistory.vendor_id == vid, VendorStatusHistory.from_status.isnot(None)).all():
                h.at = ago(30) if h.to_status == VendorStatus.ACTIVE else ago(2)
            v.decided_at = ago(30) if v.status != VendorStatus.PENDING_VERIFICATION else None
            v.decided_by_id = cm.id if v.status != VendorStatus.PENDING_VERIFICATION else None

            for doc_type, st, valid_till, label in DOCS[vid]:
                fname = (label.lower().replace(" ", "_") if label else doc_type) + ".pdf"
                content = pdf_bytes(f"{v.legal_name} - {label or doc_type}")
                status = DocumentStatus(st)
                doc = VendorDocument(
                    vendor_id=vid, doc_type=VendorDocType(doc_type), custom_label=label, original_filename=fname, content_type="application/pdf",
                    size_bytes=len(content), content=content, status=status, valid_till=valid_till, uploaded_at=ago(35),
                )
                db.add(doc)
                db.flush()
                if status == DocumentStatus.VERIFIED:
                    # Mirrors routers/vendors.py's verify_vendor_document() exactly
                    # (reviewed_by/at + the same audit action name), just backdated.
                    doc.reviewed_by_id, doc.reviewed_at = cm.id, ago(30)
                    record(db, "vendor.document_verified", "vendor", vid, actor=cm, entity_label=v.legal_name,
                           before={"status": "pending"}, after={"status": "verified"}, meta={"document": label or doc_type})
        db.flush()
        print(f"Vendors: {len(vendors)} with documents and real status-transition history")

        # ---- grandfather price-competitiveness history (must run before the
        # final rating snapshot below, so price_competitiveness is in place
        # when recompute_overall() last runs for each vendor/type).
        for title, code, months_ago, bids_spec in GRANDFATHER_TENDERS:
            p = products[code]
            due = ago(days=months_ago * 30)
            t = Tender(facility_id=facility.id, title=title, tender_type=TenderType.RFQ, status=TenderStatus.AWARDED,
                      department="Central Stores", description=f"{title} (archived -- superseded by later contracts).",
                      publish_date=due - timedelta(days=10), published_at=due - timedelta(days=10), bid_due_date=due,
                      round_number=1, created_by_id=officer.id, created_at=due - timedelta(days=12), awarded_at=due + timedelta(days=5))
            db.add(t)
            db.flush()
            li = TenderLineItem(tender_id=t.id, product_master_id=p.id, procurement_type=p.procurement_type, qty=1, estimated_price=bids_spec[0][1],
                                published=True, line_details={}, created_at=t.created_at,
                                technical_closed_at=due + timedelta(hours=6), technical_closed_by_id=cm.id)
            db.add(li)
            db.flush()
            results = []
            for vid, price, gst in bids_spec:
                b = Bid(tender_line_item_id=li.id, vendor_id=vid, status=BidStatus.SUBMITTED, unit_price=price, gst_percent=gst,
                        other_duties=0, delivery_lead_days=7, quote_validity_days=90, payment_terms=vendors[vid].payment_terms,
                        compliant_full=True, submitted_at=due - timedelta(days=1), created_at=due - timedelta(days=2))
                db.add(b)
                db.flush()
                db.add(BidEvaluation(bid_id=b.id, evaluator_id=cm.id, decision=TechnicalDecision.QUALIFIED, comments="Meets specification"))
                res = BidTechnicalResult(bid_id=b.id, outcome=TechnicalDecision.QUALIFIED)
                db.add(res)
                db.flush()
                results.append(res)
            # Real pipeline: records a PriceCompetitivenessRecord per qualified
            # bid, then refreshes price_competitiveness + overall_score for
            # every vendor touched -- exactly what closing commercial
            # evaluation does live (routers/evaluation.py).
            _update_price_competitiveness(db, li, results)
            for pcr in db.query(PriceCompetitivenessRecord).filter(PriceCompetitivenessRecord.tender_line_item_id == li.id).all():
                pcr.recorded_at = due
        db.flush()
        print(f"Grandfather price history: {len(GRANDFATHER_TENDERS)} archived tenders feeding real PriceCompetitivenessRecords")

        # ---- ratings: manual sub-scores, via the exact RatingHistory +
        # audit-log shape routers/ratings.py's real PATCH endpoint produces.
        for vid, by_type in RATINGS.items():
            for ptype, (otd, qual, comp, resp) in by_type.items():
                rating = get_or_create_rating(vid, ptype, db)
                changes = {"on_time_pct": otd, "quality_pct": qual, "compliance_pct": comp, "responsiveness": resp}
                before, after = {}, {}
                for field, new_value in changes.items():
                    old_value = getattr(rating, field)
                    before[field], after[field] = old_value, new_value
                    depth = RATING_HISTORY_DEPTH.get((vid, ptype, field))
                    if depth:
                        earlier_value, days_ago = depth
                        db.add(RatingHistory(rating_id=rating.id, field=field, old_value=None, new_value=earlier_value,
                                             comment="Initial entry", entered_by_id=cm.id, entered_at=ago(days_ago)))
                        material = abs(new_value - earlier_value) >= MATERIAL_CHANGE_THRESHOLD
                        db.add(RatingHistory(rating_id=rating.id, field=field, old_value=earlier_value, new_value=new_value,
                                             comment="Quarterly review" if material else None, entered_by_id=cm.id, entered_at=ago(1)))
                    else:
                        db.add(RatingHistory(rating_id=rating.id, field=field, old_value=old_value, new_value=new_value,
                                             comment=None, entered_by_id=cm.id, entered_at=ago(1)))
                    setattr(rating, field, new_value)
                rating.last_manual_update_at = ago(1)
                old_overall = rating.overall_score
                rating.recompute_overall()
                record(db, "rating.manual_entry", "rating", rating.id, actor=cm, entity_label=f"{rating.vendor.legal_name} — {ptype.value}",
                       before={**before, "overall_score": old_overall}, after={**after, "overall_score": rating.overall_score},
                       meta={"vendor_id": vid})
        db.flush()
        print(f"Ratings: manual entries + history for {sum(len(v) for v in RATINGS.values())} vendor/type pairs")

        # ---- mappings, via the real log_transition() helper (history row +
        # audit log in one call, matching routers/mappings.py exactly).
        for vid, target, st, days, reason in MAPPINGS:
            kind, key = target.split(":", 1)
            state = MappingState(st)
            m = VendorMapping(
                vendor_id=vid, state=MappingState.PENDING, requested_at=ago(days),
                category_id=cats[key].id if kind == "cat" else None,
                product_master_id=products[key].id if kind == "item" else None,
                version=1,
            )
            db.add(m)
            db.flush()
            # Mirrors create_pending_mapping()'s own initial history+audit
            # insert exactly -- not calling that function directly since it
            # gates on the vendor already being Active (CLAUDE.md PROJECT
            # OVERRIDE), which vendor 5's still-pending request deliberately
            # predates.
            db.add(VendorMappingHistory(mapping_id=m.id, from_state=None, to_state=MappingState.PENDING, at=ago(days)))
            record(db, "mapping.requested", "mapping", m.id, actor=vendors[vid], entity_label=f"{vendors[vid].legal_name} — {key}",
                   after={"state": MappingState.PENDING}, meta={"vendor_id": vid})
            if state != MappingState.PENDING:
                log_transition(db, m, state, cm.id, reason)
                m.decided_by_id, m.decided_at = cm.id, ago(days - 0.5)
                for h in m.history:
                    if h.to_state == state:
                        h.at = ago(days - 0.5)
        db.flush()
        print(f"Mappings: {len(MAPPINGS)}")

        # ---- tenders, lines, invites, approval rounds, line attachments
        # (tender line exclusions are created further below, once the lines
        # they reference exist)
        tenders, lines = {}, {}
        for tid, title, ttype, status, dept, due, rc, tlines in TENDERS:
            published = due - timedelta(days=10)
            t = Tender(
                id=tid, facility_id=facility.id, title=title, tender_type=ttype, status=status, department=dept,
                description=f"{title}. Delivery to {dept}, City Central Hospital.", publish_date=published, published_at=published,
                bid_due_date=due, round_number=1, created_by_id=officer.id, created_at=published - timedelta(days=2),
                is_rate_contract=rc, contract_start_date=TODAY + timedelta(days=7) if rc else None,
                contract_end_date=TODAY + timedelta(days=372) if rc else None,
                awarded_at=ago(1) if status == TenderStatus.AWARDED else None,
            )
            db.add(t)
            db.flush()
            tenders[tid] = t
            for idx, (code, qty, est) in enumerate(tlines):
                p = products[code]
                li = TenderLineItem(tender_id=tid, product_master_id=p.id, procurement_type=p.procurement_type, qty=qty, estimated_price=est,
                                    published=True, line_details={}, created_at=t.created_at)
                if status in (TenderStatus.AWARDED, TenderStatus.NO_AWARD):
                    li.technical_closed_at, li.technical_closed_by_id = due + timedelta(hours=6), cm.id
                db.add(li)
                db.flush()
                lines[(tid, idx)] = li
                for vid in INVITES.get(tid, {}).get(idx, []):
                    if (tid, idx, vid) in _EXCLUDED_PAIRS:
                        continue
                    rating = get_or_create_rating(vid, p.procurement_type, db)
                    db.add(TenderInvite(tender_line_item_id=li.id, vendor_id=vid, source="system", rating_at_resolution=round(rating.overall_score, 2), created_at=published))
            tier = 1
            total = sum(qty * est for _, qty, est in tlines)
            tier = 1 if total <= 100_000 else 2 if total <= 1_000_000 else 3
            db.add(TenderApprovalRound(tender_id=tid, round_number=1, decision=RoundDecision.APPROVED, required_tier=tier, submitted_by_id=officer.id,
                                       submitted_at=published - timedelta(days=1), reviewer_id=auth3.id if tier == 3 else auth1.id,
                                       comments="Approved", decided_at=published))
        for tid, idx, vid, reason in EXCLUSIONS:
            db.add(TenderLineExclusion(tender_line_item_id=lines[(tid, idx)].id, vendor_id=vid, reason=reason, created_at=ago(2)))
        for tid, idx, kind, title in LINE_ATTACHMENTS:
            _attach_to_line(db, lines[(tid, idx)].id, kind, title, officer.id)
        vendors[5].expedited_review_tender_id = 48
        vendors[5].expedited_review_requested_at = ago(1)
        db.flush()
        print(f"Tenders: {len(tenders)} current + {len(GRANDFATHER_TENDERS)} archived, {len(lines)} current lines, {len(EXCLUSIONS)} exclusion(s), {len(LINE_ATTACHMENTS)} line attachment(s)")

        # ---- bids + bid attachments
        bids = {}
        for tid, idx, vid, st, price, gst, lead, valid, brand, sub_days in BIDS:
            b = Bid(
                tender_line_item_id=lines[(tid, idx)].id, vendor_id=vid, status=st, unit_price=price, gst_percent=gst, other_duties=0,
                delivery_lead_days=lead, quote_validity_days=valid, payment_terms=vendors[vid].payment_terms, compliant_full=True,
                brand_offered=brand, details={"shelf_life_months": 20} if lines[(tid, idx)].procurement_type == I else {},
                submitted_at=ago(sub_days) if sub_days is not None else None, created_at=ago(sub_days or 1),
            )
            db.add(b)
            bids[(tid, idx, vid)] = b
        db.flush()
        for tid, idx, vid, kind, title in BID_ATTACHMENTS:
            _attach_to_bid(db, bids[(tid, idx, vid)].id, kind, title)
        db.flush()

        # ---- tender 34: evaluation, award, PO files
        rounds = []
        for idx, winner in AWARDS_34.items():
            line_bids = [b for (tid, i, _), b in bids.items() if tid == 34 and i == idx]
            for b in line_bids:
                db.add(BidEvaluation(bid_id=b.id, evaluator_id=cm.id, decision=TechnicalDecision.QUALIFIED, comments="Meets specification"))
                db.add(BidTechnicalResult(bid_id=b.id, outcome=TechnicalDecision.QUALIFIED))
            win = bids[(34, idx, winner)]
            line = lines[(34, idx)]
            value = win.unit_price * line.qty * (1 + win.gst_percent / 100)
            low = min(line_bids, key=lambda b: b.unit_price)
            rnd = AwardRound(line_item_id=line.id, round_number=1, status="approved", kind="award", system_top_bid_id=low.id,
                             is_override=win.id != low.id, officer_reason="L1, qualified" if win.id == low.id else "Better delivery commitment",
                             recommended_by_id=officer.id, recommended_at=ago(3), submitted_at=ago(3), required_tier=1 if value <= 100_000 else 2,
                             award_value=value, decision_kind="approved_recommendation", decided_by_id=auth3.id, decided_at=ago(1), decision_comments="Approved")
            db.add(rnd)
            db.flush()
            db.add(AwardAllocation(round_id=rnd.id, bid_id=win.id, share_pct=100, stage="proposed"))
            db.add(AwardAllocation(round_id=rnd.id, bid_id=win.id, share_pct=100, stage="final"))
            rounds.append(rnd)
        db.flush()
        for r in rounds:
            db.refresh(r)
        files = generate_for_tender(db, tenders[34], auth3, rounds)
        for f in files:
            f.generated_at = ago(1)
        # tender 43 closed with no bids
        db.add(AwardRound(line_item_id=lines[(43, 0)].id, round_number=1, status="approved", kind="exclude", decision_kind="auto_no_bids",
                          recommended_at=ago(6), decided_at=ago(6), decision_comments="No bids received"))
        print(f"Award: tender 34 awarded, {len(files)} PO data files")

        # ---- overrides (Decisions page), via the real create/approve/reject --
        # also produces StaffNotification rows for the already-decided ones,
        # same as a real decision would.
        def ov(otype, entity_type, entity_id, label, why, change, outcome, created, decided_delay_hours=1, decider=None, decision_reason=None, trigger_value=None):
            req = create_override(
                db, override_type=otype, initiator=officer, entity_type=entity_type, entity_id=entity_id, entity_label=label,
                facility_id=facility.id, justification=why, proposed_change=change, trigger_value=trigger_value,
            )
            db.flush()
            req.created_at = created
            req.sla_due_at = created + timedelta(hours=48)
            if req.status == OverrideStatus.PENDING_APPROVAL:
                if outcome == OverrideStatus.APPROVED:
                    approve_override(db, req, decider or cm, decision_reason or "Approved")
                    req.decided_at = created + timedelta(hours=decided_delay_hours)
                elif outcome == OverrideStatus.REJECTED:
                    reject_override(db, req, decider or cm, decision_reason or "Not approved")
                    req.decided_at = created + timedelta(hours=decided_delay_hours)
            else:
                # Self-attested type, officer already holds the default
                # approver authority for it -- create_override() itself
                # auto-approved this one on the spot (spec 12.5: "still
                # recorded as a distinct Approved step -- auto-approved
                # within that authority, not skipped"). Nothing left to
                # decide; just backdate it to match the rest of this
                # vendor/tender's history.
                req.decided_at = created + timedelta(hours=decided_delay_hours)
            for n in db.query(StaffNotification).filter(StaffNotification.user_id == officer.id).order_by(StaffNotification.id.desc()).limit(1).all():
                n.created_at = req.decided_at
            return req

        P = OverrideStatus.PENDING_APPROVAL
        l49 = lines[(49, 0)]
        ov(OverrideType.INVITE_LIST_MANUAL_ADD, "tender_line_item", l49.id, "#49 OPD Linen Laundry – 12 Month Contract — Linen Laundry Service — PharmaLink Distributors",
           "Only two eligible vendors for laundry; PharmaLink runs a laundry unit in Kolkata",
           {"tender_id": 49, "line_item_id": l49.id, "vendor_id": 3, "vendor_name": "PharmaLink Distributors", "line_value": 24000 * 26}, P, ago(0, 3))
        t46 = tenders[46]
        # trigger_value (8 days) deliberately exceeds DUE_DATE_EXTENSION's
        # configured 7-day self-attestation threshold (app/seed.py) -- past
        # that, even the Officer's own default authority isn't enough and
        # this escalates to Category Manager for a real decision, which is
        # the whole point of a "Pending" row on the Decisions page. Below the
        # threshold, create_override() auto-approves it on the spot instead
        # (see the officer-initiated #42 case below) -- there'd be nothing
        # left pending to show.
        ov(OverrideType.DUE_DATE_EXTENSION, "tender", 46, "#46 Annual Rate Contract – Surgical Consumables FY26-27",
           "3 of 5 lines have no submitted bid yet",
           {"before": t46.bid_due_date.isoformat(), "after": (t46.bid_due_date + timedelta(days=8)).isoformat(), "extension_days": 8}, P, ago(0, 2), trigger_value=8.0)
        r2 = db.query(VendorRating).filter_by(vendor_id=2, procurement_type=I).one()
        ov(OverrideType.PRICE_COMPETITIVENESS_OVERRIDE, "vendor_rating", r2.id, "SurgiCare Supplies Ltd — item",
           "Last two quotes were within 5% of L1", {"before": r2.price_competitiveness, "after": 70.0}, P, ago(0, 4))
        l34g = lines[(34, 1)]
        ov(OverrideType.INVITE_LIST_MANUAL_ADD, "tender_line_item", l34g.id, "#34 OPD Expansion – Reagents, OT Table & Laundry — Glucose Reagent Kit — PharmaLink Distributors",
           "Local supplier, quick delivery",
           {"tender_id": 34, "line_item_id": l34g.id, "vendor_id": 3, "vendor_name": "PharmaLink Distributors", "line_value": 50 * 2200},
           OverrideStatus.APPROVED, ago(12), decided_delay_hours=24, decider=cm)
        b41 = bids[(41, 0, 1)]
        ov(OverrideType.LATE_SUBMISSION_EXCEPTION, "bid", b41.id, "#41 Glucose Reagent Kit – Urgent Requirement — Glucose Reagent Kit — MedEquip Solutions Pvt Ltd",
           "Portal outage reported by vendor", {"before": "pending_late_exception", "after": "submitted"},
           OverrideStatus.APPROVED, ago(1, 1), decided_delay_hours=1, decider=cm)
        t42 = tenders[42]
        ov(OverrideType.DUE_DATE_EXTENSION, "tender", 42, "#42 Glucose Reagent Kit – Top-up Order", "Only one vendor had responded",
           {"before": (t42.bid_due_date - timedelta(days=3)).isoformat(), "after": t42.bid_due_date.isoformat(), "extension_days": 3},
           OverrideStatus.APPROVED, ago(2), decided_delay_hours=2, decider=officer, trigger_value=3.0)
        db.flush()

        # ---- vendor notifications (MedEquip: 4 unread) -- written as plain
        # Notification rows directly, not through notify_vendor(), so this
        # section can never trigger a real email regardless of kind.
        for kind, title, body, tid, days, read in [
            ("invited", "Invited: OPD Linen Laundry – 12 Month Contract", "You are invited to bid on 1 line. Bids close in 8 days.", 49, 0.2, False),
            ("invited", "Invited: Laboratory Reagents – Q3 Supply", "You are invited to bid on 2 lines.", 48, 0.3, False),
            ("documents_verified", "8 documents verified", "Your KYC documents were verified by the category manager.", None, 0.5, False),
            ("awarded", "Awarded: OPD Expansion – 2 of 3 lines", "Linen Laundry Service and Glucose Reagent Kit were awarded to you.", 34, 1, False),
            ("regret", "Not selected: OT Table (electro-hydraulic)", "Another bid was selected for this line on tender #34.", 34, 1, True),
        ]:
            db.add(Notification(vendor_id=1, kind=kind, title=title, body=body, tender_id=tid, created_at=ago(days), read_at=ago(0.1) if read else None))

        db.commit()
        print("Done. Category manager: category@medsource.local / changeme123 · Vendor: rohan@medequipsolutions.co / vendor12345")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run(allow_wipe="--wipe" in sys.argv)
