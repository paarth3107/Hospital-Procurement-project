"""bid form: draft/withdrawn status, typed fields, attachments

Revision ID: b7e2f4a91c30
Revises: a1d0c7e94b21
"""
import sqlalchemy as sa
from alembic import op

revision = "b7e2f4a91c30"
down_revision = "a1d0c7e94b21"
branch_labels = None
depends_on = None

KINDS = ("DATASHEET", "MANUFACTURER_AUTHORIZATION", "SOW_METHOD", "MANPOWER_PLAN", "WARRANTY_DOCUMENT", "CERTIFICATION", "INSURANCE_PROOF", "PHOTO", "OTHER")


def upgrade() -> None:
    # Alembic autogenerate misses enum value additions; do them by hand.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE bidstatus ADD VALUE IF NOT EXISTS 'DRAFT'")
        op.execute("ALTER TYPE bidstatus ADD VALUE IF NOT EXISTS 'WITHDRAWN'")

    op.alter_column("bids", "unit_price", existing_type=sa.Float(), nullable=True)
    op.alter_column("bids", "submitted_at", existing_type=sa.DateTime(timezone=True), nullable=True, server_default=None)
    op.add_column("bids", sa.Column("gst_percent", sa.Float(), nullable=True))
    op.add_column("bids", sa.Column("other_duties", sa.Float(), nullable=True))
    op.add_column("bids", sa.Column("delivery_lead_days", sa.Integer(), nullable=True))
    op.add_column("bids", sa.Column("quote_validity_days", sa.Integer(), nullable=True))
    op.add_column("bids", sa.Column("payment_terms", sa.Text(), nullable=True))
    op.add_column("bids", sa.Column("technical_compliance", sa.Text(), nullable=True))
    op.add_column("bids", sa.Column("brand_offered", sa.String(), nullable=True))
    op.add_column("bids", sa.Column("details", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("bids", sa.Column("amended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bids", sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bids", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))
    op.add_column("bids", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()))

    op.create_table(
        "bid_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bid_id", sa.Integer(), sa.ForeignKey("bids.id"), nullable=False),
        sa.Column("kind", sa.Enum(*KINDS, name="bidattachmentkind"), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("original_filename", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_bid_attachments_bid_id", "bid_attachments", ["bid_id"])


def downgrade() -> None:
    op.drop_table("bid_attachments")
    op.execute("DROP TYPE IF EXISTS bidattachmentkind")
    for col in ("updated_at", "created_at", "withdrawn_at", "amended_at", "details", "brand_offered", "technical_compliance", "payment_terms", "quote_validity_days", "delivery_lead_days", "other_duties", "gst_percent"):
        op.drop_column("bids", col)
