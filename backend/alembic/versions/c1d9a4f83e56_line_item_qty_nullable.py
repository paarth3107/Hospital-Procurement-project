"""tender line item qty nullable

Revision ID: c1d9a4f83e56
Revises: b8e3f0a71c45
Create Date: 2026-10-01 00:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "c1d9a4f83e56"
down_revision = "b8e3f0a71c45"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("tender_line_items", "qty", existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    op.alter_column("tender_line_items", "qty", existing_type=sa.Float(), nullable=False)
