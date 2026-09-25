"""Creates one facility and one Procurement Admin login for local dev/testing.
Run with: venv/Scripts/python.exe -m app.seed
"""

from app.database import SessionLocal
from app.models.approval_band import ApprovalBand
from app.models.facility import Facility
from app.models.user_account import Role, UserAccount
from app.security import hash_password

ADMIN_EMAIL = "admin@medsource.local"
ADMIN_PASSWORD = "changeme123"

# One demo login per staff role beyond Procurement Admin, so the role-scoped
# nav (frontend/js/nav.js ROLE_TABS) can actually be clicked through locally
# instead of only ever being tested as the one super-role account.
DEMO_STAFF = [
    ("officer@medsource.local", "changeme123", "Priya Sharma (Procurement Officer)", Role.PROCUREMENT_OFFICER, None),
    ("category@medsource.local", "changeme123", "Ravi Kumar (Category Manager)", Role.CATEGORY_MANAGER, None),
    ("authority1@medsource.local", "changeme123", "Dr. Anjali Rao (Approving Authority, Tier 1)", Role.APPROVING_AUTHORITY, 1),
    ("authority3@medsource.local", "changeme123", "Dr. Vikram Singh (Approving Authority, Tier 3)", Role.APPROVING_AUTHORITY, 3),
    ("sysadmin@medsource.local", "changeme123", "System Admin (seed)", Role.SYSTEM_ADMIN, None),
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


def run():
    db = SessionLocal()
    try:
        facility = db.query(Facility).filter(Facility.legal_entity_code == "CCH-001").first()
        if not facility:
            facility = Facility(name="City Central Hospital", legal_entity_code="CCH-001")
            db.add(facility)
            db.commit()
            db.refresh(facility)
            print(f"Created facility: {facility.name} (id={facility.id})")
        else:
            print(f"Facility already exists (id={facility.id})")

        admin = db.query(UserAccount).filter(UserAccount.email == ADMIN_EMAIL).first()
        if not admin:
            admin = UserAccount(
                email=ADMIN_EMAIL,
                hashed_password=hash_password(ADMIN_PASSWORD),
                full_name="Procurement Admin (seed)",
                role=Role.PROCUREMENT_ADMIN,
                facility_id=facility.id,
            )
            db.add(admin)
            db.commit()
            print(f"Created Procurement Admin login: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
        else:
            print("Admin user already exists")

        for email, password, full_name, role, approval_tier in DEMO_STAFF:
            existing = db.query(UserAccount).filter(UserAccount.email == email).first()
            if existing:
                continue
            db.add(
                UserAccount(
                    email=email,
                    hashed_password=hash_password(password),
                    full_name=full_name,
                    role=role,
                    facility_id=facility.id,
                    approval_tier=approval_tier,
                )
            )
            db.commit()
            print(f"Created {role.value} login: {email} / {password}")

        if db.query(ApprovalBand).count() == 0:
            for band in DEFAULT_APPROVAL_BANDS:
                db.add(ApprovalBand(facility_id=None, **band))
            db.commit()
            print(f"Seeded {len(DEFAULT_APPROVAL_BANDS)} group-wide approval bands")
        else:
            print("Approval bands already exist")
    finally:
        db.close()


if __name__ == "__main__":
    run()
