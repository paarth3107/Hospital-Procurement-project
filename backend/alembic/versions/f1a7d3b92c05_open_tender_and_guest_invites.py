"""open tender flag and guest invite reason

Revision ID: f1a7d3b92c05
Revises: e2b7c4a9f168
Create Date: 2026-10-06 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "f1a7d3b92c05"
down_revision = "e2b7c4a9f168"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenders", sa.Column("open_tender", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("tender_invites", sa.Column("reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tender_invites", "reason")
    op.drop_column("tenders", "open_tender")
