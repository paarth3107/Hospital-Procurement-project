"""Creates one facility and one Procurement Admin login for local dev/testing.
Run with: venv/Scripts/python.exe -m app.seed
"""

from app.database import SessionLocal
from app.models.approval_band import ApprovalBand
from app.models.facility import Facility
from app.models.override import OverrideType, OverrideTypeConfig
from app.models.user_account import Role, UserAccount
from app.security import hash_password
from app.services.overrides import DEFAULT_SLA_HOURS

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

# Spec §12.3's table, as hospital-configurable data (CLAUDE.md: "model as
# config"). "Department Head" and "Finance/Management Committee" aren't
# separate roles here (see user_account.py's own note) -- they map onto
# APPROVING_AUTHORITY at the same tiers DEFAULT_APPROVAL_BANDS already uses
# (tier 2 = Department Head, tier 3 = + Finance/Management Committee), so the
# two configurable matrices stay consistent with each other. Thresholds are
# illustrative starting points (spec's own footnote, CLAUDE.md open question
# 2) — trigger_value's meaning is per-type and documented per row; a few
# types (score-correction changing the qualification outcome, PO re-export
# changing price/qty) are pass/fail, not a scalar band, so they have no
# numeric threshold and rely on whichever module wires them in calling
# escalate_override() explicitly instead.
DEFAULT_OVERRIDE_CONFIGS = [
    {
        "override_type": OverrideType.PRICE_COMPETITIVENESS_OVERRIDE,
        "default_approver_role": Role.PROCUREMENT_ADMIN,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
        "escalation_threshold": 15.0,  # score-point range the adjustment must not exceed
    },
    {
        "override_type": OverrideType.INVITE_LIST_MANUAL_ADD,
        "default_approver_role": Role.PROCUREMENT_ADMIN,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
        "escalation_threshold": 200_000.0,  # cumulative override value on the tender
    },
    {
        "override_type": OverrideType.GUEST_VENDOR_INVITE,
        "default_approver_role": Role.PROCUREMENT_OFFICER, "self_attested": True,
        "escalate_to_role": Role.PROCUREMENT_ADMIN,
        "escalation_threshold": 3.0,  # guest count per tender
    },
    {
        "override_type": OverrideType.TECHNICAL_SCORE_CORRECTION,
        "default_approver_role": Role.PROCUREMENT_ADMIN,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
    },
    {
        "override_type": OverrideType.LATE_SUBMISSION_EXCEPTION,
        "default_approver_role": Role.PROCUREMENT_ADMIN,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
        "escalation_threshold": 1_000_000.0,  # tender value
    },
    {
        "override_type": OverrideType.DUE_DATE_EXTENSION,
        "default_approver_role": Role.PROCUREMENT_OFFICER, "self_attested": True,
        "escalate_to_role": Role.PROCUREMENT_ADMIN,
        "escalation_threshold": 7.0,  # cumulative extension days requested
    },
    {
        "override_type": OverrideType.NON_L1_AWARD_OVERRIDE,
        "default_approver_role": Role.PROCUREMENT_ADMIN,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 3,
        "escalation_threshold": 1_000_000.0,  # award value
    },
    {
        "override_type": OverrideType.PO_REEXPORT,
        "default_approver_role": Role.PROCUREMENT_ADMIN,
        "escalate_to_role": Role.APPROVING_AUTHORITY, "escalate_to_min_tier": 2,
    },
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

        if db.query(OverrideTypeConfig).count() == 0:
            for config in DEFAULT_OVERRIDE_CONFIGS:
                db.add(OverrideTypeConfig(sla_hours=DEFAULT_SLA_HOURS, **config))
            db.commit()
            print(f"Seeded {len(DEFAULT_OVERRIDE_CONFIGS)} override type configs")
        else:
            print("Override type configs already exist")
    finally:
        db.close()


if __name__ == "__main__":
    run()
