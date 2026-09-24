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
from app.models.product_master import ProcurementType, ProductCategory, ProductMaster
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
    "vendor_status_history",
    "vendors",
    "product_master",
    "product_categories",
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

# Spec 3.2 registration fields for the demo vendors (merged into VENDORS).
VENDOR_EXTRA = [
    dict(trade_name="MedEquip", entity_type="Private Limited", year_of_incorporation=2004, registered_address="Unit 7, Marol MIDC, Andheri East, Mumbai 400093, Maharashtra",
         branch_locations="Pune; Ahmedabad", bank_name="HDFC Bank", bank_account_number="50200041123456", bank_ifsc="HDFC0000234",
         contact_designation="Sales Director", escalation_contact_name="Meera Shah", escalation_contact_phone="9820099887", escalation_contact_email="meera@medequipsolutions.co",
         payment_terms="45 days from GRN", delivery_lead_time_days=10, min_order_value=25000.0),
    dict(trade_name="SurgiCare", entity_type="Public Limited", year_of_incorporation=1998, registered_address="14 Residency Road, Bengaluru 560025, Karnataka",
         branch_locations="Chennai", bank_name="ICICI Bank", bank_account_number="000405012345", bank_ifsc="ICIC0000004",
         contact_designation="Regional Manager", escalation_contact_name="Ramesh Nair", escalation_contact_phone="9845099001", escalation_contact_email=None,
         payment_terms="30 days from invoice", delivery_lead_time_days=7, min_order_value=10000.0),
    dict(trade_name="PharmaLink", entity_type="Partnership", year_of_incorporation=2011, registered_address="8 Park Street, Kolkata 700016, West Bengal",
         branch_locations=None, bank_name="State Bank of India", bank_account_number="30012345678", bank_ifsc="SBIN0000691",
         contact_designation="Managing Partner", escalation_contact_name="Anup Iyer", escalation_contact_phone="9051177889", escalation_contact_email=None,
         payment_terms="60 days from GRN", delivery_lead_time_days=5, min_order_value=15000.0),
    dict(trade_name="CleanTech", entity_type="LLP", year_of_incorporation=2015, registered_address="Plot 22, Okhla Industrial Area, New Delhi 110020",
         branch_locations="Noida; Gurugram", bank_name="Axis Bank", bank_account_number="917020012345678", bank_ifsc="UTIB0000123",
         contact_designation="Operations Head", escalation_contact_name="Rahul Desai", escalation_contact_phone="9911066778", escalation_contact_email="rahul@cleantechhs.co",
         payment_terms="30 days from invoice", delivery_lead_time_days=3, min_order_value=50000.0),
    dict(trade_name="NextGen", entity_type="Private Limited", year_of_incorporation=2019, registered_address="Plot 44, IDA Nacharam, Hyderabad 500076, Telangana",
         branch_locations=None, bank_name="HDFC Bank", bank_account_number="50200099887766", bank_ifsc="HDFC0000345",
         contact_designation="Director", escalation_contact_name="Sunita Rao", escalation_contact_phone="9789012345", escalation_contact_email=None,
         payment_terms="45 days from GRN", delivery_lead_time_days=21, min_order_value=100000.0),
]
for _vendor, _extra in zip(VENDORS, VENDOR_EXTRA):
    _vendor.update(_extra)

PRODUCTS = [
    dict(
        code="SURG-GLOVES-001",
        name="Surgical Gloves (Latex, Size M)",
        description="Sterile single-use surgical gloves, box of 100",
        procurement_type=ProcurementType.ITEM,
        category="Consumables",
        sub_category="PPE",
        unit_of_measure="Box of 100",
        reorder_level=50,
        price_band_min=6.0,
        price_band_max=12.0,
        type_specific_attrs={"pack_size": "100 pcs", "shelf_life_tracking": True, "storage_condition": "Store below 30 C, dry"},
    ),
    dict(
        code="XRAY-MACH-001",
        name="Digital X-Ray Machine",
        description="Ceiling-mounted digital radiography system",
        procurement_type=ProcurementType.ASSET,
        category="Imaging Equipment",
        sub_category="Radiology",
        regulatory_class="AERB licensed",
        approved_brands=["Siemens", "GE", "Philips"],
        type_specific_attrs={
            "expected_useful_life_years": 10,
            "warranty_months": 24,
            "installation_required": True,
            "amc_cmc_applicable": True,
            "compliance_certifications": ["CE", "AERB"],
            "site_readiness": "Lead-lined room, 3-phase power, ceiling load check",
        },
    ),
    dict(
        code="HKEEP-SVC-001",
        name="Housekeeping & Sanitation Service",
        description="Facility-wide housekeeping and sanitation, monthly contract",
        procurement_type=ProcurementType.SERVICE,
        category="Facility Services",
        sub_category="Housekeeping",
        type_specific_attrs={
            "default_tenure_months": 12,
            "sla_response_time_hours": 2,
            "sla_penalty_clauses": "1% of monthly fee per missed audit",
            "billing_basis": "fixed",
            "manpower_deployment_norms": "1 supervisor per 15 staff",
        },
    ),
    dict(
        code="ICU-BED-001",
        name="ICU Bed with Electric Adjustment",
        description="Fowler-position electric ICU bed with side rails",
        procurement_type=ProcurementType.ASSET,
        category="Patient Care Equipment",
        sub_category="Critical Care",
        type_specific_attrs={"warranty_months": 36, "installation_required": True, "compliance_certifications": ["ISO 13485"]},
    ),
    dict(
        code="MED-SYRINGE-001",
        name="Disposable Syringes (10ml)",
        description="Single-use disposable syringes, box of 100",
        procurement_type=ProcurementType.ITEM,
        category="Consumables",
        sub_category="General Supplies",
        unit_of_measure="Box of 100",
        type_specific_attrs={"pack_size": "100 pcs", "shelf_life_tracking": True},
    ),
    # A restricted entry: mapping needs a minimum item rating (spec 4.4).
    dict(
        code="IMPL-HIP-001",
        name="Total Hip Implant (Cemented)",
        description="Cemented total hip replacement implant set",
        procurement_type=ProcurementType.ITEM,
        category="Implants",
        sub_category="Orthopaedic",
        regulatory_class="Class III implant",
        approved_brands=["Zimmer Biomet", "Stryker"],
        min_mapping_rating=80.0,
        type_specific_attrs={"pack_size": "1 set", "shelf_life_tracking": True, "storage_condition": "Sterile, room temperature"},
    ),
]

# Categories that need a minimum vendor rating before ANY mapping to them is approved.
CATEGORY_MIN_RATING = {"Implants": 75.0}

# (vendor index, product index) pairs, 0-based into VENDORS/PRODUCTS above.
MAPPINGS = [(0, 0), (0, 4), (1, 1), (2, 3), (3, 2)]

# (vendor index, category name, state): category-level mappings. An approved
# category mapping makes the vendor eligible for every item in it.
CATEGORY_MAPPINGS = [
    (2, "Consumables", MappingState.APPROVED),  # PharmaLink covers gloves + syringes
    (4, "Consumables", MappingState.PENDING),   # NextGen's request awaiting review
]

# Per-type rating tweaks on top of RATINGS: vendor index -> {type: delta}.
# Shows that a vendor can be strong in one type and weaker in another.
RATING_TYPE_DELTA = {
    0: {ProcurementType.SERVICE: -20.0},
    3: {ProcurementType.ITEM: -15.0},
}

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

        categories: dict[tuple[str, ProcurementType], ProductCategory] = {}
        for p in PRODUCTS:
            key = (p["category"], p["procurement_type"])
            if key not in categories:
                categories[key] = ProductCategory(
                    name=key[0], procurement_type=key[1], min_mapping_rating=CATEGORY_MIN_RATING.get(key[0])
                )
                db.add(categories[key])
        db.flush()
        products = []
        for p in PRODUCTS:
            fields = {k: v for k, v in p.items() if k != "category"}
            products.append(ProductMaster(category_id=categories[(p["category"], p["procurement_type"])].id, **fields))
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
        for vendor_idx, category_name, state in CATEGORY_MAPPINGS:
            category = next(c for (name, _), c in categories.items() if name == category_name)
            mapping = VendorMapping(
                vendor_id=vendors[vendor_idx].id,
                category_id=category.id,
                state=state,
                decided_at=datetime.now(timezone.utc) if state == MappingState.APPROVED else None,
            )
            db.add(mapping)
            db.flush()
            db.add(VendorMappingHistory(mapping_id=mapping.id, from_state=None, to_state=MappingState.PENDING))
            if state == MappingState.APPROVED:
                db.add(VendorMappingHistory(mapping_id=mapping.id, from_state=MappingState.PENDING, to_state=MappingState.APPROVED))
        db.commit()
        print(f"Created {len(MAPPINGS)} item mappings and {len(CATEGORY_MAPPINGS)} category mappings")

        # Ratings are per (vendor, procurement type); the demo gives each
        # vendor the same manual scores in all three types.
        for vendor_idx, fields in RATINGS.items():
            for ptype in ProcurementType:
                delta = RATING_TYPE_DELTA.get(vendor_idx, {}).get(ptype, 0.0)
                typed = {k: (None if v is None else max(0.0, min(100.0, v + delta))) for k, v in fields.items()}
                rating = VendorRating(
                    vendor_id=vendors[vendor_idx].id, procurement_type=ptype, price_competitiveness=50.0, **typed
                )
                rating.recompute_overall()
                if any(v is not None for v in typed.values()):
                    rating.last_manual_update_at = datetime.now(timezone.utc)
                db.add(rating)
                db.flush()
                for field, value in typed.items():
                    if value is not None:
                        db.add(RatingHistory(rating_id=rating.id, field=field, old_value=None, new_value=value, comment="Initial demo data"))
        db.commit()
        print(f"Created ratings for {len(RATINGS)} vendors x {len(ProcurementType)} procurement types")

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
        first_line_item.published = bool(eligible)
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
