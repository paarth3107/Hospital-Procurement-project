"""Wipes business/domain data and reseeds a small, coherent demo dataset:
5 vendors, 5 catalog entries, 5 vendor mappings, 5 vendor ratings, 5 draft
tenders (each with one line item). Facilities, staff logins, and approval
bands (infrastructure/config, not "test data") are left untouched -- wiping
those would lock you out of the app you're trying to test.

Run with: venv/Scripts/python.exe -m app.seed_demo
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.database import SessionLocal
from app.models.product_master import ProcurementType, ProductMaster
from app.models.tender import Tender, TenderStatus, TenderType
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.user_account import Role, UserAccount
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_mapping import MappingState, VendorMapping, VendorMappingHistory
from app.security import hash_password
from app.services.eligibility import resolve_eligible_vendors
from app.models.vendor_rating import RatingHistory, VendorRating

# Business/domain tables only -- children before parents. Facilities,
# user_accounts, and approval_bands are deliberately excluded.
WIPE_TABLES = [
    "tender_invites",
    "tender_approval_rounds",
    "tender_line_items",
    "tenders",
    "rating_history",
    "vendor_ratings",
    "vendor_mapping_history",
    "vendor_mappings",
    "vendor_documents",
    "vendors",
    "product_master",
]

VENDORS = [
    dict(
        legal_name="MedEquip Solutions Pvt Ltd",
        gstin="27AAAPM1234C1Z5",
        pan="AAAPM1234C",
        contact_person="Rohan Mehta",
        email="rohan@medequipsolutions.co",
        phone="9820011122",
        category_declaration="Equipment",
        status=VendorStatus.ACTIVE,
    ),
    dict(
        legal_name="SurgiCare Supplies Ltd",
        gstin="29AABCS5678D1Z2",
        pan="AABCS5678D",
        contact_person="Kavita Nair",
        email="kavita@surgicaresupplies.co",
        phone="9845022233",
        category_declaration="Consumables",
        status=VendorStatus.ACTIVE,
    ),
    dict(
        legal_name="PharmaLink Distributors",
        gstin="19AACFP4321E1Z8",
        pan="AACFP4321E",
        contact_person="Suresh Iyer",
        email="suresh@pharmalink.co",
        phone="9051133344",
        category_declaration="Pharma",
        status=VendorStatus.ACTIVE,
    ),
    dict(
        legal_name="CleanTech Hospital Services",
        gstin="07AADCC8765F1Z3",
        pan="AADCC8765F",
        contact_person="Anita Desai",
        email="anita@cleantechhs.co",
        phone="9911044455",
        category_declaration="Facility Services",
        status=VendorStatus.ACTIVE,
    ),
    dict(
        legal_name="NextGen Diagnostics Pvt Ltd",
        gstin="33AAECN2468G1Z6",
        pan="AAECN2468G",
        contact_person="Vikram Rao",
        email="vikram@nextgendiagnostics.co",
        phone="9789055566",
        category_declaration="Equipment",
        status=VendorStatus.PENDING_VERIFICATION,
    ),
]

PRODUCTS = [
    dict(
        code="SURG-GLOVES-001",
        name="Surgical Gloves (Latex, Size M)",
        description="Sterile single-use surgical gloves, box of 100",
        procurement_type=ProcurementType.ITEM,
        category="Consumables",
        sub_category="PPE",
    ),
    dict(
        code="XRAY-MACH-001",
        name="Digital X-Ray Machine",
        description="Ceiling-mounted digital radiography system",
        procurement_type=ProcurementType.ASSET,
        category="Imaging Equipment",
        sub_category="Radiology",
    ),
    dict(
        code="HKEEP-SVC-001",
        name="Housekeeping & Sanitation Service",
        description="Facility-wide housekeeping and sanitation, monthly contract",
        procurement_type=ProcurementType.SERVICE,
        category="Facility Services",
        sub_category="Housekeeping",
    ),
    dict(
        code="ICU-BED-001",
        name="ICU Bed with Electric Adjustment",
        description="Fowler-position electric ICU bed with side rails",
        procurement_type=ProcurementType.ASSET,
        category="Patient Care Equipment",
        sub_category="Critical Care",
    ),
    dict(
        code="MED-SYRINGE-001",
        name="Disposable Syringes (10ml)",
        description="Single-use disposable syringes, box of 100",
        procurement_type=ProcurementType.ITEM,
        category="Consumables",
        sub_category="General Supplies",
    ),
]

# (vendor index, product index) pairs, 0-based into VENDORS/PRODUCTS above.
MAPPINGS = [(0, 0), (0, 4), (1, 1), (2, 3), (3, 2)]

# vendor index -> manual rating fields (None = leave unset/provisional)
RATINGS = {
    0: dict(on_time_pct=90.0, quality_pct=88.0, compliance_pct=95.0, responsiveness=85.0),
    1: dict(on_time_pct=75.0, quality_pct=80.0, compliance_pct=70.0, responsiveness=78.0),
    2: dict(on_time_pct=60.0, quality_pct=65.0, compliance_pct=72.0, responsiveness=68.0),
    3: dict(on_time_pct=95.0, quality_pct=92.0, compliance_pct=90.0, responsiveness=91.0),
    4: dict(on_time_pct=None, quality_pct=None, compliance_pct=None, responsiveness=None),
}

VENDOR_DEMO_PASSWORD = "vendor12345"

# (title, tender_type, department, product index, qty, estimated_price/unit)
TENDERS = [
    ("Supply of Surgical Gloves - FY26 Q1", TenderType.RFQ, "Surgery", 0, 5000, 8.5),
    ("Digital X-Ray Machine Procurement", TenderType.RFP, "Radiology", 1, 1, 1_500_000.0),
    ("Annual Housekeeping Services Contract", TenderType.RFP, "Facilities", 2, 12, 45_000.0),
    ("ICU Bed Procurement - 20 Units", TenderType.RFP, "Critical Care", 3, 20, 250_000.0),
    ("Disposable Syringes Annual Supply", TenderType.RFQ, "Nursing", 4, 100_000, 3.2),
]


def run():
    db = SessionLocal()
    try:
        print("Wiping business/domain data (facilities, staff logins, approval bands untouched)...")
        for table in WIPE_TABLES:
            db.execute(text(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE"))
        db.commit()

        creator = db.query(UserAccount).filter(UserAccount.role == Role.PROCUREMENT_OFFICER).first()
        if not creator:
            creator = db.query(UserAccount).filter(UserAccount.role == Role.PROCUREMENT_ADMIN).first()
        if not creator:
            raise RuntimeError("No staff login found -- run `python -m app.seed` first")

        vendors = [Vendor(**v, hashed_password=hash_password(VENDOR_DEMO_PASSWORD)) for v in VENDORS]
        db.add_all(vendors)
        db.commit()
        for v in vendors:
            db.refresh(v)
        print(f"Created {len(vendors)} vendors (login password for all: {VENDOR_DEMO_PASSWORD})")

        products = [ProductMaster(**p) for p in PRODUCTS]
        db.add_all(products)
        db.commit()
        for p in products:
            db.refresh(p)
        print(f"Created {len(products)} catalog entries")

        for vendor_idx, product_idx in MAPPINGS:
            mapping = VendorMapping(
                vendor_id=vendors[vendor_idx].id,
                product_master_id=products[product_idx].id,
                state=MappingState.APPROVED,
                decided_at=datetime.now(timezone.utc),
            )
            db.add(mapping)
            db.flush()
            db.add(VendorMappingHistory(mapping_id=mapping.id, from_state=None, to_state=MappingState.PENDING))
            db.add(VendorMappingHistory(mapping_id=mapping.id, from_state=MappingState.PENDING, to_state=MappingState.APPROVED))
        db.commit()
        print(f"Created {len(MAPPINGS)} approved vendor mappings")

        for vendor_idx, fields in RATINGS.items():
            rating = VendorRating(vendor_id=vendors[vendor_idx].id, price_competitiveness=50.0, **fields)
            rating.recompute_overall()
            if any(v is not None for v in fields.values()):
                rating.last_manual_update_at = datetime.now(timezone.utc)
            db.add(rating)
            db.flush()
            for field, value in fields.items():
                if value is not None:
                    db.add(RatingHistory(rating_id=rating.id, field=field, old_value=None, new_value=value, comment="Initial demo data"))
        db.commit()
        print(f"Created {len(RATINGS)} vendor ratings")

        bid_due = datetime.now(timezone.utc) + timedelta(days=14)
        first_tender, first_line_item = None, None
        for i, (title, tender_type, department, product_idx, qty, unit_price) in enumerate(TENDERS):
            tender = Tender(
                facility_id=1,
                title=title,
                description=f"Demo tender: {title}",
                tender_type=tender_type,
                status=TenderStatus.DRAFT,
                department=department,
                min_rating_threshold=0.0,
                bid_due_date=bid_due,
                created_by_id=creator.id,
            )
            db.add(tender)
            db.flush()
            line_item = TenderLineItem(
                tender_id=tender.id,
                product_master_id=products[product_idx].id,
                procurement_type=products[product_idx].procurement_type,
                qty=qty,
                estimated_price=unit_price,
            )
            db.add(line_item)
            db.flush()
            if i == 0:
                first_tender, first_line_item = tender, line_item
        db.commit()
        print(f"Created {len(TENDERS)} draft tenders, each with 1 line item")

        # Publish the first tender so the vendor dashboard/bidding flow has
        # something real to show immediately -- everything else stays Draft
        # so the E-Tender Approval queue also has something to demonstrate.
        eligible = resolve_eligible_vendors(first_line_item, db)
        for e in eligible:
            db.add(TenderInvite(tender_line_item_id=first_line_item.id, vendor_id=e.vendor.id, rating_at_resolution=e.rating_score))
        first_tender.status = TenderStatus.PUBLISHED
        first_tender.round_number = 1
        first_tender.published_at = datetime.now(timezone.utc)
        db.add(
            TenderApprovalRound(
                tender_id=first_tender.id,
                round_number=1,
                decision=RoundDecision.APPROVED,
                required_tier=1,
                submitted_by_id=creator.id,
                reviewer_id=creator.id,
                decided_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
        print(f"Published '{first_tender.title}' with {len(eligible)} invited vendor(s)")

        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
