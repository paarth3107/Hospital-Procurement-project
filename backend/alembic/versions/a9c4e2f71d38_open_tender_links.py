"""open tender registration links

Revision ID: a9c4e2f71d38
Revises: f1a7d3b92c05
Create Date: 2026-10-06 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "a9c4e2f71d38"
down_revision = "f1a7d3b92c05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenders", sa.Column("open_link_token", sa.String(), nullable=True))
    op.create_unique_constraint("uq_tenders_open_link_token", "tenders", ["open_link_token"])
    op.execute("UPDATE tenders SET open_link_token = md5(random()::text || id::text) WHERE open_tender")
    op.add_column("vendors", sa.Column("registered_via_tender_id", sa.Integer(), sa.ForeignKey("tenders.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "registered_via_tender_id")
    op.drop_constraint("uq_tenders_open_link_token", "tenders", type_="unique")
    op.drop_column("tenders", "open_link_token")
