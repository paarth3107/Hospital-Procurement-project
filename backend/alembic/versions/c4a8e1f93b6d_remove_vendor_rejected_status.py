"""remove vendor REJECTED status: merge into BLACKLISTED

User-directed, 2026-10-24: spec 3.4 itself already writes "Rejected /
Blacklisted" as one outcome, and nothing in this codebase ever gave the two
a different real-world effect -- both were dead ends, and REJECTED had no
reinstate path at all (unlike BLACKLISTED's existing Category-Manager
reinstate flow). Data-migrates every REJECTED value (across vendors.status
and vendor_status_history.from_status/to_status) to BLACKLISTED, then drops
REJECTED from each column's allowed ENUM set.

Revision ID: c4a8e1f93b6d
Revises: b9e2f4c817a3
Create Date: 2026-10-24 10:00:00.000000

"""
from alembic import op


revision = "c4a8e1f93b6d"
down_revision = "b9e2f4c817a3"
branch_labels = None
depends_on = None

_STATUS_ENUM_WITH_REJECTED = "ENUM('DRAFT','PENDING_VERIFICATION','INFO_REQUESTED','ACTIVE','SUSPENDED','REJECTED','BLACKLISTED')"
_STATUS_ENUM_WITHOUT_REJECTED = "ENUM('DRAFT','PENDING_VERIFICATION','INFO_REQUESTED','ACTIVE','SUSPENDED','BLACKLISTED')"

_COLUMNS = [
    ("vendors", "status", "NOT NULL"),
    ("vendor_status_history", "from_status", "NULL"),
    ("vendor_status_history", "to_status", "NOT NULL"),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        for table, column, _ in _COLUMNS:
            op.execute(f"UPDATE {table} SET {column} = 'BLACKLISTED' WHERE {column} = 'REJECTED'")
        return
    for table, column, nullability in _COLUMNS:
        op.execute(f"UPDATE {table} SET {column} = 'BLACKLISTED' WHERE {column} = 'REJECTED'")
        op.execute(f"ALTER TABLE {table} MODIFY COLUMN {column} {_STATUS_ENUM_WITHOUT_REJECTED} {nullability}")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    # Data can't be un-migrated meaningfully (we don't know which rows were
    # originally REJECTED vs. genuinely BLACKLISTED) -- this only restores
    # the enum option, same fallback reasoning as the PROCUREMENT_ADMIN
    # removal migration (e8b2f6a4c913).
    for table, column, nullability in _COLUMNS:
        op.execute(f"ALTER TABLE {table} MODIFY COLUMN {column} {_STATUS_ENUM_WITH_REJECTED} {nullability}")
