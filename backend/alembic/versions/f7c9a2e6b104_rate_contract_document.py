"""rate contract agreement document

Revision ID: f7c9a2e6b104
Revises: e4b8d2a715f3
Create Date: 2026-10-07 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "f7c9a2e6b104"
down_revision = "e4b8d2a715f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenders", sa.Column("rate_contract_document_filename", sa.String(), nullable=True))
    op.add_column("tenders", sa.Column("rate_contract_document_content_type", sa.String(), nullable=True))
    op.add_column("tenders", sa.Column("rate_contract_document_size", sa.Integer(), nullable=True))
    op.add_column("tenders", sa.Column("rate_contract_document_content", sa.LargeBinary(), nullable=True))
    op.add_column("tenders", sa.Column("rate_contract_document_uploaded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tenders", sa.Column("rate_contract_document_uploaded_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("tenders", "rate_contract_document_uploaded_by_id")
    op.drop_column("tenders", "rate_contract_document_uploaded_at")
    op.drop_column("tenders", "rate_contract_document_content")
    op.drop_column("tenders", "rate_contract_document_size")
    op.drop_column("tenders", "rate_contract_document_content_type")
    op.drop_column("tenders", "rate_contract_document_filename")
