"""rate contract flag and contract dates

Revision ID: d1a6f93c2e58
Revises: b3e8f1d2c4a7
Create Date: 2026-10-07 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "d1a6f93c2e58"
down_revision = "b3e8f1d2c4a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenders", sa.Column("is_rate_contract", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("tenders", sa.Column("contract_start_date", sa.Date(), nullable=True))
    op.add_column("tenders", sa.Column("contract_end_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenders", "contract_end_date")
    op.drop_column("tenders", "contract_start_date")
    op.drop_column("tenders", "is_rate_contract")
