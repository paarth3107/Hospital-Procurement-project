"""bid vendor comments

Revision ID: d4e6a9c1f207
Revises: c1d9a4f83e56
Create Date: 2026-10-01 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "d4e6a9c1f207"
down_revision = "c1d9a4f83e56"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bids", sa.Column("comments", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("bids", "comments")
