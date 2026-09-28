"""price competitiveness records (spec 5.2/5.3): the one rating sub-score the system computes itself

Revision ID: b6d4f18a2c73
Revises: a3e6f0c2d9b4
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b6d4f18a2c73"
down_revision = "a3e6f0c2d9b4"
branch_labels = None
depends_on = None

PTYPE = postgresql.ENUM("ITEM", "ASSET", "SERVICE", name="procurementtype", create_type=False)


def upgrade() -> None:
    op.create_table(
        "price_competitiveness_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("procurement_type", PTYPE, nullable=False),
        sa.Column("bid_id", sa.Integer(), sa.ForeignKey("bids.id"), nullable=False),
        sa.Column("tender_line_item_id", sa.Integer(), sa.ForeignKey("tender_line_items.id"), nullable=False),
        sa.Column("price_score", sa.Float(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("bid_id", name="uq_price_competitiveness_bid"),
    )
    op.create_index("ix_price_competitiveness_records_vendor_id", "price_competitiveness_records", ["vendor_id"])


def downgrade() -> None:
    op.drop_table("price_competitiveness_records")
