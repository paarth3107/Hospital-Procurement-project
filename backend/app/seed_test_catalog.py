"""ADDITIVE test-catalog seed for manual QA: new categories, sub-categories and
products. Never deletes anything; anything whose name/code already exists is
skipped, so it is safe to re-run on the current dev database.

Every record is validated through the same pydantic schemas the API uses
(CategoryCreate / SubCategoryCreate / ProductCreate), so what lands here is
exactly what the "Add" forms would accept.

Run from the backend folder:
    venv\\Scripts\\python.exe -m app.seed_test_catalog
"""

import os
import sys

sys.path.insert(0, os.getcwd())

from app import models  # noqa: E402,F401
from app.database import SessionLocal  # noqa: E402
from app.models.product_master import ProcurementType as T, ProductCategory, ProductMaster, ProductSubCategory  # noqa: E402
from app.schemas.product import CategoryCreate, ProductCreate, SubCategoryCreate  # noqa: E402

# (name, type, min_mapping_rating, required_documents, [sub-categories])
CATEGORIES = [
    ("Surgical Instruments", T.ITEM, 50, ["gst_certificate", "iso_certificate"], ["Forceps & Scissors", "Sutures & Needles"]),
    ("Blood Bank Supplies", T.ITEM, None, ["drug_license", "other:Cold chain certificate"], ["Blood Bags", "Transfusion Sets"]),
    ("Dental Supplies", T.ITEM, None, [], []),  # no sub-categories, no products: empty-state test
    ("Operation Theatre Equipment", T.ASSET, 60, ["iso_certificate", "other:OEM Authorization letter"], ["Surgical Lights & Tables", "Anaesthesia Machines"]),
    ("Dialysis & Renal Care", T.ASSET, None, ["gst_certificate"], ["Dialysis Machines"]),
    ("Hospital Software", T.SERVICE, None, ["gst_certificate", "other:Data security certification"], ["HIS / EMR Licensing", "Custom Development"]),
    ("Biomedical Waste Management", T.SERVICE, None, ["business_license", "other:Pollution Control Board authorization"], ["Collection & Disposal"]),
]

# (code, name, type, category, sub-category or None, core fields, type-specific attrs)
PRODUCTS = [
    ("SURG-FORC-001", "Artery Forceps (Straight, 14 cm)", T.ITEM, "Surgical Instruments", "Forceps & Scissors",
     dict(unit_of_measure="Piece", regulatory_class="Class A", approved_brands=["Aesculap", "Medicon"], reorder_level=50, price_band_min=300, price_band_max=900),
     dict(pack_size="Box of 12", hsn_sac_code="90189099", alternate_brand_allowed=True)),
    ("SURG-SCIS-001", "Mayo Scissors (Curved, 17 cm)", T.ITEM, "Surgical Instruments", "Forceps & Scissors",
     dict(unit_of_measure="Piece", regulatory_class="Class A", reorder_level=40, price_band_min=450, price_band_max=1400),
     dict(pack_size="Single", hsn_sac_code="90189099")),
    ("SURG-SUT-001", "Polyglactin 910 Suture 2-0 (Absorbable)", T.ITEM, "Surgical Instruments", "Sutures & Needles",
     dict(unit_of_measure="Box", regulatory_class="Class B", approved_brands=["Ethicon", "Healthium"], reorder_level=100, price_band_min=1200, price_band_max=2600, min_mapping_rating=65, required_documents=["drug_license"]),
     dict(pack_size="Box of 12", shelf_life_tracking=True, storage_condition="Room temperature, below 30 C", hsn_sac_code="30051090", alternate_brand_allowed=False)),
    ("SURG-NEED-001", "Surgical Needle, Cutting 3/8 Circle", T.ITEM, "Surgical Instruments", "Sutures & Needles",
     dict(unit_of_measure="Pack", reorder_level=200, price_band_min=80, price_band_max=300),
     dict(pack_size="Pack of 6", shelf_life_tracking=False)),
    ("BLOOD-BAG-001", "Triple Blood Bag CPDA-1 (350 ml)", T.ITEM, "Blood Bank Supplies", "Blood Bags",
     dict(unit_of_measure="Piece", regulatory_class="Class C", reorder_level=500, price_band_min=90, price_band_max=220),
     dict(pack_size="Carton of 50", shelf_life_tracking=True, storage_condition="Store at 2-30 C", hsn_sac_code="39269099")),
    ("BLOOD-TSET-001", "Blood Transfusion Set with Filter", T.ITEM, "Blood Bank Supplies", "Transfusion Sets",
     dict(unit_of_measure="Piece", reorder_level=800, price_band_min=20, price_band_max=60),
     dict(pack_size="Box of 100", shelf_life_tracking=True, alternate_brand_allowed=True)),
    ("BLOOD-REAG-001", "Blood Grouping Anti-Sera Kit", T.ITEM, "Blood Bank Supplies", None,  # no sub-category: tests the "uncategorised" path
     dict(unit_of_measure="Kit", reorder_level=30, price_band_min=500, price_band_max=1500),
     dict(shelf_life_tracking=True, storage_condition="Cold chain 2-8 C")),
    ("OT-LIGHT-001", "LED Surgical Light (Dual Dome, Ceiling Mounted)", T.ASSET, "Operation Theatre Equipment", "Surgical Lights & Tables",
     dict(regulatory_class="Class B", approved_brands=["Dr. Mach", "Trumpf"], price_band_min=250000, price_band_max=900000),
     dict(asset_category="OT fixed equipment", expected_useful_life_years=12, warranty_months=24, installation_required=True, compliance_certifications=["CE", "ISO 13485"],
          site_readiness="Ceiling load-bearing check, dedicated power circuit", training_required=True, training_details="1-day OT staff orientation",
          spares_commitment_months=96, amc_cmc_type="amc", amc_cmc_procurement="separate_service_tender")),
    ("OT-TABLE-001", "Electro-Hydraulic OT Table", T.ASSET, "Operation Theatre Equipment", "Surgical Lights & Tables",
     dict(price_band_min=400000, price_band_max=1200000),
     dict(expected_useful_life_years=15, warranty_months=36, installation_required=True, amc_cmc_type="cmc", amc_cmc_procurement="bundled_with_purchase")),
    ("OT-ANAES-001", "Anaesthesia Workstation with Ventilator", T.ASSET, "Operation Theatre Equipment", "Anaesthesia Machines",
     dict(regulatory_class="Class C", price_band_min=1500000, price_band_max=3500000, min_mapping_rating=75),
     dict(asset_category="Critical care equipment", expected_useful_life_years=10, warranty_months=24, installation_required=True, compliance_certifications=["CE", "FDA"],
          training_required=True, spares_commitment_months=120, insurance_requirement="Transit and installation insurance required",
          amc_cmc_type="cmc", amc_cmc_procurement="bundled_with_purchase")),
    ("DIAL-MACH-001", "Haemodialysis Machine (with RO Plant Interface)", T.ASSET, "Dialysis & Renal Care", "Dialysis Machines",
     dict(regulatory_class="Class C", price_band_min=600000, price_band_max=1500000),
     dict(expected_useful_life_years=10, warranty_months=24, installation_required=True, compliance_certifications=["CE"], amc_cmc_type="amc", amc_cmc_procurement="separate_service_tender")),
    ("DIAL-RO-001", "Dialysis RO Water Treatment Plant", T.ASSET, "Dialysis & Renal Care", None,
     dict(price_band_min=800000, price_band_max=2000000),
     dict(warranty_months=12, installation_required=True, site_readiness="Plumbing, drainage and 3-phase power", amc_cmc_type="none")),
    ("SW-HIS-001", "Hospital Information System (SaaS Licence)", T.SERVICE, "Hospital Software", "HIS / EMR Licensing",
     dict(price_band_min=1500000, price_band_max=6000000),
     dict(software_kind="licensing", license_type="saas", deployment_model="cloud", seats_or_usage_tier="Up to 500 concurrent users", license_tenure_renewal="3 years, auto-renew annually",
          data_residency_dpdp="Data to be hosted within India; DPDP Act compliant", support_sla_tier="24x7 Gold", upgrade_patch_policy="Quarterly patches, annual major release",
          exit_data_portability="Full data export in open formats within 30 days", default_tenure_months=36, billing_basis="fixed")),
    ("SW-DEV-001", "Custom Patient Portal Development", T.SERVICE, "Hospital Software", "Custom Development",
     dict(price_band_min=800000, price_band_max=3000000),
     dict(software_kind="development", deliverables_sow="Web + mobile patient portal: appointments, reports, billing", source_code_ownership_escrow="Source code owned by hospital",
          ip_assignment="Full IP assigned to hospital on final payment", acceptance_testing_criteria="UAT sign-off, zero critical defects", warranty_defect_fix_period="12 months",
          post_go_live_support="6 months hypercare", technology_stack_constraints="Python/Django or Node, React frontend", billing_basis="milestone")),
    ("BMW-COLL-001", "Biomedical Waste Collection & Disposal", T.SERVICE, "Biomedical Waste Management", "Collection & Disposal",
     dict(price_band_min=15, price_band_max=45),
     dict(sow_template="Daily collection from all wards, colour-coded segregation, CBWTF disposal", default_tenure_months=24, renewal_terms="Renewable yearly on satisfactory performance",
          sla_response_time_hours=4, sla_uptime_pct=99, sla_penalty_clauses="2% of monthly invoice per missed daily collection", billing_basis="consumption",
          manpower_deployment_norms="Trained handlers with PPE and vaccination", background_verification_required=True, statutory_compliance_notes="BMW Rules 2016, CPCB manifest records")),
    ("SVC-PEST-001", "Pest Control & Fumigation Service", T.SERVICE, "Biomedical Waste Management", None,
     dict(),
     dict(default_tenure_months=12, billing_basis="fixed", sla_response_time_hours=24)),
]


def main() -> None:
    db = SessionLocal()
    made = {"categories": 0, "sub-categories": 0, "products": 0}
    try:
        cats: dict[str, ProductCategory] = {}
        subs: dict[tuple[str, str], ProductSubCategory] = {}
        for name, ptype, min_rating, docs, sub_names in CATEGORIES:
            data = CategoryCreate(name=name, procurement_type=ptype, min_mapping_rating=min_rating, required_documents=docs)
            cat = db.query(ProductCategory).filter_by(name=data.name, procurement_type=ptype).first()
            if cat is None:
                cat = ProductCategory(name=data.name, procurement_type=ptype, min_mapping_rating=data.min_mapping_rating, required_documents=data.required_documents)
                db.add(cat)
                db.flush()
                made["categories"] += 1
            cats[name] = cat
            for sub_name in sub_names:
                sdata = SubCategoryCreate(name=sub_name, category_id=cat.id)
                sub = db.query(ProductSubCategory).filter_by(name=sdata.name, category_id=cat.id).first()
                if sub is None:
                    sub = ProductSubCategory(name=sdata.name, category_id=cat.id)
                    db.add(sub)
                    db.flush()
                    made["sub-categories"] += 1
                subs[(name, sub_name)] = sub

        for code, name, ptype, cat_name, sub_name, core, attrs in PRODUCTS:
            if db.query(ProductMaster).filter_by(code=code).first():
                continue
            cat = cats[cat_name]
            data = ProductCreate(code=code, name=name, procurement_type=ptype, category_id=cat.id,
                                 sub_category_id=subs[(cat_name, sub_name)].id if sub_name else None, type_specific_attrs=attrs, **core)
            db.add(ProductMaster(**data.model_dump()))
            made["products"] += 1
        db.commit()
        print("Created:", made)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
