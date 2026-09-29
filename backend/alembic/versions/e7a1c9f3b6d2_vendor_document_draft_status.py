"""vendor document DRAFT status -- staged in the vendor's own document vault,
invisible to staff until a "Submit documents" action promotes it to Pending

Revision ID: e7a1c9f3b6d2
Revises: d2e4f6a8b0c2
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op

revision = "e7a1c9f3b6d2"
down_revision = "d2e4f6a8b0c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS 'DRAFT'")


def downgrade() -> None:
    # Postgres can't drop an enum value; anything left in DRAFT (shouldn't be,
    # since it's only ever a vendor-visible staging state) is treated as Pending.
    op.execute("UPDATE vendor_documents SET status = 'PENDING' WHERE status = 'DRAFT'")
