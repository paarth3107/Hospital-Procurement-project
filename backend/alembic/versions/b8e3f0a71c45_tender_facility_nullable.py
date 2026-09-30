"""tender facility_id nullable

Revision ID: b8e3f0a71c45
Revises: f4c7b1e29d83
Create Date: 2026-10-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "b8e3f0a71c45"
down_revision = "f4c7b1e29d83"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("tenders", "facility_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("tenders", "facility_id", existing_type=sa.Integer(), nullable=False)
