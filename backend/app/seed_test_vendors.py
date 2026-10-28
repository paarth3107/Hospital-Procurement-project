"""ADDITIVE test-vendor seed for manual QA. Unlike app/seed.py it never deletes
anything: it only inserts vendors (skipping any whose email already exists),
so it is safe to run against the current dev database.

Every vendor gets password Test@123 and an @mailinator.com email. Status
changes go through the real set_status(), so status history, audit log and
vendor notifications are populated as in real use.

Run from the backend folder:
    venv\\Scripts\\python.exe -m app.seed_test_vendors
"""

import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.getcwd())

from app import models  # noqa: E402,F401
from app.database import SessionLocal  # noqa: E402
from app.models.user_account import Role, UserAccount  # noqa: E402
from app.models.vendor import (  # noqa: E402
    DocumentStatus, Vendor, VendorDocType, VendorDocument, VendorStatus, VendorStatusHistory,
)
from app.security import hash_password  # noqa: E402
from app.seed import pdf_bytes  # noqa: E402
from app.services.vendor_status import set_status  # noqa: E402

PASSWORD = "Test@123"
MANDATORY = ["gst_certificate", "pan_card", "incorporation_certificate", "bank_proof", "sample_catalog"]

# status = the state the vendor ends up in; docs = how its mandatory documents look.
VENDORS = [
    dict(status="active", docs="verified", legal_name="Apex Surgical Instruments Pvt Ltd", trade_name="Apex Surgical", entity_type="Private Limited",
         gstin="27AABCA1101A1Z5", pan="AABCA1101A", year_of_incorporation=2008,
         registered_address="Plot 21, MIDC Industrial Area, Taloja", city="Navi Mumbai", state="Maharashtra", pincode="410208",
         bank_name="HDFC Bank", bank_account_number="50200011223344", bank_ifsc="HDFC0001101",
         contact_person="Arjun Kapoor", contact_designation="Sales Head", email="apex.surgical@mailinator.com", phone="9900110001",
         payment_terms="30 days from GRN", delivery_lead_time_days=7, min_order_value=20000,
         category_declaration="Consumables,Patient Care Equipment"),
    dict(status="active", docs="verified", legal_name="LifeLine Pharma Distributors LLP", trade_name="LifeLine Pharma", entity_type="LLP",
         gstin="29AACFL2202B1Z8", pan="AACFL2202B", year_of_incorporation=2013,
         registered_address="14, Avenue Road, Chickpet", city="Bengaluru", state="Karnataka", pincode="560002",
         bank_name="ICICI Bank", bank_account_number="038401002233", bank_ifsc="ICIC0000384",
         contact_person="Sneha Rao", contact_designation="Director", email="lifeline.pharma@mailinator.com", phone="9900110002",
         payment_terms="45 days from GRN", delivery_lead_time_days=5, min_order_value=15000,
         category_declaration="Pharmaceuticals,Consumables"),
    dict(status="active", docs="verified", legal_name="TechMed IT Solutions Pvt Ltd", trade_name="TechMed IT", entity_type="Private Limited",
         gstin="07AAECT3303C1Z2", pan="AAECT3303C", year_of_incorporation=2016,
         registered_address="C-45, Sector 63, Noida Phase 3", city="Noida", state="Uttar Pradesh", pincode="201301",
         bank_name="Axis Bank", bank_account_number="917010055667788", bank_ifsc="UTIB0000917",
         contact_person="Rahul Verma", contact_designation="Business Manager", email="techmed.it@mailinator.com", phone="9900110003",
         payment_terms="30 days from invoice", delivery_lead_time_days=10, min_order_value=50000,
         category_declaration="IT Equipment,IT Services"),
    dict(status="active", docs="verified", legal_name="PureClean Facility Services", trade_name="PureClean", entity_type="Partnership",
         gstin="24AAFFP4404D1Z9", pan="AAFFP4404D", year_of_incorporation=2011,
         registered_address="B-9, GIDC Estate, Vatva", city="Ahmedabad", state="Gujarat", pincode="382445",
         bank_name="State Bank of India", bank_account_number="30112233445", bank_ifsc="SBIN0003011",
         contact_person="Nisha Patel", contact_designation="Operations Head", email="pureclean.fs@mailinator.com", phone="9900110004",
         payment_terms="30 days from invoice", delivery_lead_time_days=3, min_order_value=10000,
         category_declaration="Facility Services,Dietary & Laundry Services"),
    dict(status="pending_verification", docs="pending", legal_name="BioGenix Diagnostics Pvt Ltd", trade_name="BioGenix", entity_type="Private Limited",
         gstin="36AABCB5505E1Z6", pan="AABCB5505E", year_of_incorporation=2020,
         registered_address="Plot 33, Genome Valley, Shamirpet", city="Hyderabad", state="Telangana", pincode="500078",
         bank_name="Kotak Mahindra Bank", bank_account_number="7411223344", bank_ifsc="KKBK0007411",
         contact_person="Kiran Reddy", contact_designation="Founder", email="biogenix.diag@mailinator.com", phone="9900110005",
         payment_terms="30 days from GRN", delivery_lead_time_days=8, min_order_value=25000,
         category_declaration="Laboratory Reagents,Consumables"),
    dict(status="pending_verification", docs="mixed", legal_name="CardioCare Devices Pvt Ltd", trade_name="CardioCare", entity_type="Private Limited",
         gstin="33AACCC6606F1Z4", pan="AACCC6606F", year_of_incorporation=2018,
         registered_address="No. 8, SIDCO Industrial Estate, Guindy", city="Chennai", state="Tamil Nadu", pincode="600032",
         bank_name="Canara Bank", bank_account_number="1234500067890", bank_ifsc="CNRB0001234",
         contact_person="Lakshmi Iyer", contact_designation="Managing Director", email="cardiocare.dev@mailinator.com", phone="9900110006",
         payment_terms="60 days from GRN", delivery_lead_time_days=14, min_order_value=100000,
         category_declaration="Cardiac & Vascular Devices,Patient Care Equipment"),
    dict(status="info_requested", docs="mixed", reason="Bank proof is blurred and the GST certificate is for a different address. Please re-upload both.",
         legal_name="Medico Imaging Systems Ltd", trade_name="Medico Imaging", entity_type="Public Limited",
         gstin="19AACCM7707G1Z1", pan="AACCM7707G", year_of_incorporation=2005,
         registered_address="12/1, Park Street", city="Kolkata", state="West Bengal", pincode="700016",
         bank_name="Punjab National Bank", bank_account_number="4455667788990", bank_ifsc="PUNB0445500",
         contact_person="Debashish Sen", contact_designation="Regional Manager", email="medico.imaging@mailinator.com", phone="9900110007",
         payment_terms="45 days from GRN", delivery_lead_time_days=21, min_order_value=200000,
         category_declaration="Imaging Equipment,Diagnostic Imaging Equipment"),
    dict(status="suspended", docs="verified", reason="Repeated late deliveries: 3 of last 5 POs delivered late",
         legal_name="QuickServe Linen & Laundry", trade_name="QuickServe", entity_type="Proprietorship",
         gstin="08AAHPQ8808H1Z7", pan="AAHPQ8808H", year_of_incorporation=2014,
         registered_address="Shop 5, Sitapura Industrial Area", city="Jaipur", state="Rajasthan", pincode="302022",
         bank_name="Bank of Baroda", bank_account_number="29010100223344", bank_ifsc="BARB0SITAPU",
         contact_person="Mohit Sharma", contact_designation="Owner", email="quickserve.linen@mailinator.com", phone="9900110008",
         payment_terms="15 days from invoice", delivery_lead_time_days=2, min_order_value=5000,
         category_declaration="Dietary & Laundry Services,Facility Services"),
]


def doc_status(mode: str, doc_type: str) -> DocumentStatus:
    if mode == "verified":
        return DocumentStatus.VERIFIED
    if mode == "pending":
        return DocumentStatus.PENDING
    # mixed: a couple verified, one rejected, rest pending -- gives the reviewer every state to click through.
    return {"gst_certificate": DocumentStatus.VERIFIED, "pan_card": DocumentStatus.VERIFIED, "bank_proof": DocumentStatus.REJECTED}.get(doc_type, DocumentStatus.PENDING)


def main() -> None:
    db = SessionLocal()
    try:
        cm = db.query(UserAccount).filter(UserAccount.role == Role.CATEGORY_MANAGER).order_by(UserAccount.id).first()
        pw = hash_password(PASSWORD)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        created = []
        for spec in VENDORS:
            spec = dict(spec)
            if db.query(Vendor).filter(Vendor.email == spec["email"]).first():
                print(f"skip (exists): {spec['email']}")
                continue
            target, docs_mode, reason = VendorStatus(spec.pop("status")), spec.pop("docs"), spec.pop("reason", None)
            v = Vendor(**spec, hashed_password=pw, email_verified_at=now, created_at=now - timedelta(days=20))
            db.add(v)
            db.flush()
            db.add(VendorStatusHistory(vendor_id=v.id, from_status=None, to_status=VendorStatus.PENDING_VERIFICATION, reason="Registered", at=now - timedelta(days=20)))
            for dt in MANDATORY:
                st = doc_status(docs_mode, dt)
                content = pdf_bytes(f"{v.legal_name} - {dt}")
                doc = VendorDocument(vendor_id=v.id, doc_type=VendorDocType(dt), custom_label="", original_filename=f"{dt}.pdf",
                                     content_type="application/pdf", size_bytes=len(content), content=content, status=st,
                                     rejection_reason="Document unreadable, please re-upload" if st == DocumentStatus.REJECTED else None)
                if st in (DocumentStatus.VERIFIED, DocumentStatus.REJECTED):
                    doc.reviewed_by_id, doc.reviewed_at = cm.id, now - timedelta(days=10)
                db.add(doc)
            # one optional licence with an expiry date, to exercise expiry badges
            if docs_mode == "verified":
                content = pdf_bytes(f"{v.legal_name} - ISO certificate")
                db.add(VendorDocument(vendor_id=v.id, doc_type=VendorDocType.ISO_CERTIFICATE, custom_label="", original_filename="iso_certificate.pdf",
                                      content_type="application/pdf", size_bytes=len(content), content=content, status=DocumentStatus.VERIFIED,
                                      reviewed_by_id=cm.id, reviewed_at=now - timedelta(days=10),
                                      valid_till=date.today() + timedelta(days=20 if spec["trade_name"] == "Apex Surgical" else 365)))
            db.flush()
            if target in (VendorStatus.ACTIVE, VendorStatus.SUSPENDED):
                set_status(db, v, VendorStatus.ACTIVE, cm.id, "All mandatory documents verified")
            if target == VendorStatus.SUSPENDED:
                set_status(db, v, VendorStatus.SUSPENDED, cm.id, reason)
            if target == VendorStatus.INFO_REQUESTED:
                set_status(db, v, VendorStatus.INFO_REQUESTED, cm.id, reason)
            created.append(v)
        db.commit()
        print(f"Created {len(created)} vendors (password {PASSWORD})")
        for v in created:
            print(f"  #{v.id} {v.status.value:20} {v.email}  {v.legal_name}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
