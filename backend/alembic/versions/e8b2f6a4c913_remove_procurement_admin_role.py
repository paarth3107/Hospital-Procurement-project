"""remove PROCUREMENT_ADMIN role: merge into CATEGORY_MANAGER everywhere

Revision ID: e8b2f6a4c913
Revises: d913e5c47a02
Create Date: 2026-10-21 01:00:00.000000

User-directed (previously decided, reconfirmed 2026-10-21): Procurement Admin
and Category Manager are the same role in this build -- every require_role()
tuple already paired them, and app/services/approval_matrix.py's
can_approve_tier() already excluded Procurement Admin from the approval
matrix. This finishes the removal: data-migrates every PROCUREMENT_ADMIN
value across all 5 Enum(Role) columns to CATEGORY_MANAGER, then drops
PROCUREMENT_ADMIN from each column's allowed set. app/models/user_account.py's
Role enum no longer has this member.
"""
from alembic import op

revision = "e8b2f6a4c913"
down_revision = "d913e5c47a02"
branch_labels = None
depends_on = None

_ROLE_ENUM_WITH_PA = "ENUM('PROCUREMENT_OFFICER','PROCUREMENT_ADMIN','CATEGORY_MANAGER','APPROVING_AUTHORITY','SYSTEM_ADMIN')"
_ROLE_ENUM_WITHOUT_PA = "ENUM('PROCUREMENT_OFFICER','CATEGORY_MANAGER','APPROVING_AUTHORITY','SYSTEM_ADMIN')"

_COLUMNS = [
    ("user_accounts", "role", "NOT NULL"),
    ("override_type_configs", "default_approver_role", "NOT NULL"),
    ("override_type_configs", "escalate_to_role", "NULL"),
    ("override_requests", "initiator_role", "NOT NULL"),
    ("override_requests", "required_approver_role", "NULL"),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        for table, column, _ in _COLUMNS:
            op.execute(f"UPDATE {table} SET {column} = 'CATEGORY_MANAGER' WHERE {column} = 'PROCUREMENT_ADMIN'")
        return
    for table, column, nullability in _COLUMNS:
        op.execute(f"UPDATE {table} SET {column} = 'CATEGORY_MANAGER' WHERE {column} = 'PROCUREMENT_ADMIN'")
        op.execute(f"ALTER TABLE {table} MODIFY COLUMN {column} {_ROLE_ENUM_WITHOUT_PA} {nullability}")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    # Data can't be un-migrated meaningfully (we don't know which rows were
    # originally PROCUREMENT_ADMIN vs. genuinely CATEGORY_MANAGER) -- this
    # only restores the enum option, same fallback reasoning as the
    # TenderStatus.SCHEDULED/BidStatus.PENDING_LATE_EXCEPTION migrations.
    for table, column, nullability in _COLUMNS:
        op.execute(f"ALTER TABLE {table} MODIFY COLUMN {column} {_ROLE_ENUM_WITH_PA} {nullability}")
