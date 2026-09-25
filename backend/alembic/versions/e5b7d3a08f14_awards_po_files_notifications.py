"""L1 award rounds, allocations, PO data files, vendor notifications, Awarded tender status

Revision ID: e5b7d3a08f14
Revises: d4a91c6e2b58
"""
import sqlalchemy as sa
from alembic import op

revision = "e5b7d3a08f14"
down_revision = "d4a91c6e2b58"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tenderstatus ADD VALUE IF NOT EXISTS 'AWARDED'")

    op.add_column("tenders", sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "award_rounds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("line_item_id", sa.Integer(), sa.ForeignKey("tender_line_items.id"), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("system_top_bid_id", sa.Integer(), sa.ForeignKey("bids.id"), nullable=True),
        sa.Column("is_override", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("officer_reason", sa.Text(), nullable=True),
        sa.Column("recommended_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True),
        sa.Column("recommended_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("required_tier", sa.Integer(), nullable=True),
        sa.Column("award_value", sa.Float(), nullable=True),
        sa.Column("decision_kind", sa.String(), nullable=True),
        sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_comments", sa.Text(), nullable=True),
        sa.UniqueConstraint("line_item_id", "round_number", name="uq_award_round"),
    )
    op.create_index("ix_award_rounds_line_item_id", "award_rounds", ["line_item_id"])

    op.create_table(
        "award_allocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("round_id", sa.Integer(), sa.ForeignKey("award_rounds.id"), nullable=False),
        sa.Column("bid_id", sa.Integer(), sa.ForeignKey("bids.id"), nullable=False),
        sa.Column("share_pct", sa.Float(), nullable=False),
        sa.Column("stage", sa.String(), nullable=False),
    )
    op.create_index("ix_award_allocations_round_id", "award_allocations", ["round_id"])

    op.create_table(
        "po_data_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("batch_id", sa.String(), nullable=False, unique=True),
        sa.Column("tender_id", sa.Integer(), sa.ForeignKey("tenders.id"), nullable=False),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("generated_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True),
        sa.Column("supersedes_id", sa.Integer(), sa.ForeignKey("po_data_files.id"), nullable=True),
        sa.Column("erp_po_number", sa.String(), nullable=True),
        sa.Column("status_reason", sa.Text(), nullable=True),
        sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status_changed_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True),
    )
    op.create_index("ix_po_data_files_tender_id", "po_data_files", ["tender_id"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("tender_id", sa.Integer(), sa.ForeignKey("tenders.id"), nullable=True),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_notifications_vendor_id", "notifications", ["vendor_id"])


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("po_data_files")
    op.drop_table("award_allocations")
    op.drop_table("award_rounds")
    op.drop_column("tenders", "awarded_at")
