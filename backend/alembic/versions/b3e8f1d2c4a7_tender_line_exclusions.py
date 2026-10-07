"""vendors removed from a tender line

Revision ID: b3e8f1d2c4a7
Revises: a9c4e2f71d38
Create Date: 2026-10-06 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "b3e8f1d2c4a7"
down_revision = "a9c4e2f71d38"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tender_line_exclusions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tender_line_item_id", sa.Integer(), sa.ForeignKey("tender_line_items.id"), nullable=False),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tender_line_item_id", "vendor_id", name="uq_exclusion_line_vendor"),
    )


def downgrade() -> None:
    op.drop_table("tender_line_exclusions")
