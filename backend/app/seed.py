"""Creates one facility and one Procurement Admin login for local dev/testing.
Run with: venv/Scripts/python.exe -m app.seed
"""

from app.database import SessionLocal
from app.models.facility import Facility
from app.models.user_account import Role, UserAccount
from app.security import hash_password

ADMIN_EMAIL = "admin@medsource.local"
ADMIN_PASSWORD = "changeme123"


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
    finally:
        db.close()


if __name__ == "__main__":
    run()
