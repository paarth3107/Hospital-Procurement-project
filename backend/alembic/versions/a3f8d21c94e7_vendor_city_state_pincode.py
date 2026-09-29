"""vendor city state pincode

Revision ID: a3f8d21c94e7
Revises: e7a1c9f3b6d2
Create Date: 2026-10-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "a3f8d21c94e7"
down_revision = "e7a1c9f3b6d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendors", sa.Column("city", sa.String(), nullable=True))
    op.add_column("vendors", sa.Column("state", sa.String(), nullable=True))
    op.add_column("vendors", sa.Column("pincode", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "pincode")
    op.drop_column("vendors", "state")
    op.drop_column("vendors", "city")
