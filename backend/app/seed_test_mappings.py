"""ADDITIVE test vendor-mapping seed for manual QA. Run AFTER
app.seed_test_vendors and app.seed_test_catalog. Never deletes anything; a
mapping that already exists for the same vendor + target is skipped.

States are set through the real log_transition() helper (history row + audit
log), like routers/mappings.py. Approved/Suspended rows only go on mappings
that satisfy the app's own gates (required documents verified, minimum
rating), so the data is consistent with what the UI would allow. Mappings
that would FAIL a gate are left Pending on purpose: try approving them to
see the rating / document gate messages.

Run from the backend folder:
    venv\\Scripts\\python.exe -m app.seed_test_mappings
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.getcwd())

from app import models  # noqa: E402,F401
from app.database import SessionLocal  # noqa: E402
from app.models.product_master import ProductCategory, ProductMaster  # noqa: E402
from app.models.user_account import Role, UserAccount  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from app.models.vendor_mapping import MappingState, VendorMapping, VendorMappingHistory  # noqa: E402
from app.services.audit import record  # noqa: E402
from app.services.mappings import log_transition  # noqa: E402

# (vendor email, "cat:<category name>" | "item:<product code>", [states walked through in order], reason for the final state, days ago requested)
A, P, R, S = MappingState.APPROVED, MappingState.PENDING, MappingState.REJECTED, MappingState.SUSPENDED
MAPPINGS = [
    # Apex Surgical: approved category + an item-level override + a suspended item + gate-blocked pending ones
    ("apex.surgical@mailinator.com", "cat:Surgical Instruments", [A], "Documents verified, rating meets minimum", 30),
    ("apex.surgical@mailinator.com", "item:SURG-NEED-001", [R], "Needle gauge range not stocked by vendor", 25),
    ("apex.surgical@mailinator.com", "item:SURG-SCIS-001", [A, S], "Quality complaint: corroded batch received", 20),
    ("apex.surgical@mailinator.com", "item:SURG-SUT-001", [], None, 6),  # blocked: needs drug licence + rating 65
    ("apex.surgical@mailinator.com", "cat:Operation Theatre Equipment", [], None, 4),  # blocked: OEM letter + rating 60
    ("apex.surgical@mailinator.com", "cat:Patient Care Equipment", [A], "Approved", 28),
    # LifeLine Pharma
    ("lifeline.pharma@mailinator.com", "cat:Consumables", [A], "Approved", 35),
    ("lifeline.pharma@mailinator.com", "cat:Pharmaceuticals", [], None, 8),  # blocked: category minimum rating 70
    ("lifeline.pharma@mailinator.com", "cat:Blood Bank Supplies", [], None, 5),  # blocked: no drug licence / cold chain cert
    ("lifeline.pharma@mailinator.com", "item:BLOOD-TSET-001", [R], "Cold chain certificate not provided", 12),
    # TechMed IT
    ("techmed.it@mailinator.com", "cat:IT Equipment", [A], "Approved", 40),
    ("techmed.it@mailinator.com", "cat:IT Services", [A], "Approved", 40),
    ("techmed.it@mailinator.com", "cat:Hospital Software", [], None, 7),  # blocked: Data security certification missing
    ("techmed.it@mailinator.com", "item:SW-DEV-001", [R], "No healthcare project references submitted", 15),
    # PureClean Facility Services
    ("pureclean.fs@mailinator.com", "cat:Facility Services", [A], "Approved", 32),
    ("pureclean.fs@mailinator.com", "cat:Dietary & Laundry Services", [], None, 9),  # blocked: business licence + FSSAI missing
    ("pureclean.fs@mailinator.com", "cat:Biomedical Waste Management", [R], "No valid Pollution Control Board authorization", 18),
    # QuickServe (vendor itself suspended later: its approved mapping should stop it being eligible)
    ("quickserve.linen@mailinator.com", "cat:Facility Services", [A], "Approved", 45),
]


def main() -> None:
    db = SessionLocal()
    made = skipped = 0
    try:
        cm = db.query(UserAccount).filter(UserAccount.role == Role.CATEGORY_MANAGER).order_by(UserAccount.id).first()
        for email, target, states, reason, days in MAPPINGS:
            vendor = db.query(Vendor).filter_by(email=email).first()
            kind, key = target.split(":", 1)
            tgt = (db.query(ProductCategory).filter_by(name=key).first() if kind == "cat" else db.query(ProductMaster).filter_by(code=key).first())
            if vendor is None or tgt is None:
                print(f"skip (missing vendor/target): {email} {target}")
                skipped += 1
                continue
            col = VendorMapping.category_id if kind == "cat" else VendorMapping.product_master_id
            if db.query(VendorMapping).filter(VendorMapping.vendor_id == vendor.id, col == tgt.id).first():
                skipped += 1
                continue
            requested = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=days)
            m = VendorMapping(vendor_id=vendor.id, state=MappingState.PENDING, requested_at=requested, version=1,
                              category_id=tgt.id if kind == "cat" else None, product_master_id=tgt.id if kind == "item" else None)
            db.add(m)
            db.flush()
            db.add(VendorMappingHistory(mapping_id=m.id, from_state=None, to_state=MappingState.PENDING, at=requested))
            record(db, "mapping.requested", "mapping", m.id, actor=vendor, entity_label=f"{vendor.legal_name} — {key}",
                   after={"state": MappingState.PENDING}, meta={"vendor_id": vendor.id})
            for step, st in enumerate(states):
                log_transition(db, m, st, cm.id, reason if step == len(states) - 1 else "Approved")
                m.decided_by_id, m.decided_at = cm.id, requested + timedelta(days=1 + step)
                for h in m.history:
                    if h.to_state == st:
                        h.at = requested + timedelta(days=1 + step)
            made += 1
        db.commit()
        print(f"Created {made} mappings, skipped {skipped}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
