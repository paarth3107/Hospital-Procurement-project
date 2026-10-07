"""terms and conditions document replaces free text

Revision ID: e4b8d2a715f3
Revises: d1a6f93c2e58
Create Date: 2026-10-07 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "e4b8d2a715f3"
down_revision = "d1a6f93c2e58"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenders", sa.Column("terms_document_filename", sa.String(), nullable=True))
    op.add_column("tenders", sa.Column("terms_document_content_type", sa.String(), nullable=True))
    op.add_column("tenders", sa.Column("terms_document_size", sa.Integer(), nullable=True))
    op.add_column("tenders", sa.Column("terms_document_content", sa.LargeBinary(), nullable=True))
    op.add_column("tenders", sa.Column("terms_document_uploaded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tenders", sa.Column("terms_document_uploaded_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True))
    op.drop_column("tenders", "terms_and_conditions")


def downgrade() -> None:
    op.add_column("tenders", sa.Column("terms_and_conditions", sa.Text(), nullable=True))
    op.drop_column("tenders", "terms_document_uploaded_by_id")
    op.drop_column("tenders", "terms_document_uploaded_at")
    op.drop_column("tenders", "terms_document_content")
    op.drop_column("tenders", "terms_document_size")
    op.drop_column("tenders", "terms_document_content_type")
    op.drop_column("tenders", "terms_document_filename")
