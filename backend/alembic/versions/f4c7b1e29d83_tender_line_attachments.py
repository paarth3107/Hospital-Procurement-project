"""tender line attachments

Revision ID: f4c7b1e29d83
Revises: a3f8d21c94e7
Create Date: 2026-10-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "f4c7b1e29d83"
down_revision = "a3f8d21c94e7"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "tender_line_attachments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tender_line_item_id", sa.Integer(), sa.ForeignKey("tender_line_items.id"), nullable=False),
        # SQLAlchemy's Enum column writes the Python member's NAME, not its
        # .value -- the DB type's labels must be the uppercase names to match.
        sa.Column("kind", sa.Enum("SOW_DOCUMENT", "TECHNICAL_SPEC_SHEET", "ENGINEERING_DRAWING", "REFERENCE_IMAGE", "OTHER", name="tenderlineattachmentkind"), nullable=False),
        sa.Column("custom_label", sa.String(), nullable=True),
        sa.Column("original_filename", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True),
    )
    op.create_index("ix_tender_line_attachments_tender_line_item_id", "tender_line_attachments", ["tender_line_item_id"])


def downgrade() -> None:
    op.drop_index("ix_tender_line_attachments_tender_line_item_id", table_name="tender_line_attachments")
    op.drop_table("tender_line_attachments")
    sa.Enum(name="tenderlineattachmentkind").drop(op.get_bind(), checkfirst=True)
