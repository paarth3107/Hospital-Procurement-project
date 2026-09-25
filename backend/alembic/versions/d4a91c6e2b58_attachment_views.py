"""track which bid attachments each evaluator has opened

Revision ID: d4a91c6e2b58
Revises: c3f8a2d15e77
"""
import sqlalchemy as sa
from alembic import op

revision = "d4a91c6e2b58"
down_revision = "c3f8a2d15e77"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bid_attachment_views",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("attachment_id", sa.Integer(), sa.ForeignKey("bid_attachments.id"), nullable=False),
        sa.Column("viewer_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=False),
        sa.Column("viewed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("attachment_id", "viewer_id", name="uq_attachment_viewer"),
    )
    op.create_index("ix_bid_attachment_views_attachment_id", "bid_attachment_views", ["attachment_id"])


def downgrade() -> None:
    op.drop_table("bid_attachment_views")
