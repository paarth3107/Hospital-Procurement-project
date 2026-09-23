"""vendor document upload storage

Revision ID: df68aeabdc05
Revises: fca4c56fc631
Create Date: 2026-09-23 15:30:55.474902

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'df68aeabdc05'
down_revision: Union[str, None] = 'fca4c56fc631'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# vendor_documents has never had a real writer (no upload endpoint existed
# before this), so it's empty in every environment this migration will ever
# run against -- dropping and recreating avoids the NOT-NULL-without-default
# and VARCHAR->Enum cast issues a column-by-column ALTER would hit for no
# benefit, since there is no data to preserve.


def upgrade() -> None:
    op.drop_table('vendor_documents')
    op.create_table(
        'vendor_documents',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('vendor_id', sa.Integer(), nullable=False),
        sa.Column(
            'doc_type',
            sa.Enum('GST_CERTIFICATE', 'PAN_CARD', 'INCORPORATION_CERTIFICATE', 'BANK_PROOF', name='vendordoctype'),
            nullable=False,
        ),
        sa.Column('original_filename', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('content', sa.LargeBinary(), nullable=False),
        sa.Column(
            'status',
            sa.Enum('PENDING', 'VERIFIED', 'REJECTED', name='documentstatus'),
            nullable=False,
        ),
        sa.Column('rejection_reason', sa.Text(), nullable=True),
        sa.Column('reviewed_by_id', sa.Integer(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id']),
        sa.ForeignKeyConstraint(['reviewed_by_id'], ['user_accounts.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('vendor_id', 'doc_type', name='uq_vendor_doctype'),
    )


def downgrade() -> None:
    op.drop_table('vendor_documents')
    op.create_table(
        'vendor_documents',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('vendor_id', sa.Integer(), nullable=False),
        sa.Column('doc_type', sa.String(), nullable=False),
        sa.Column('file_ref', sa.String(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['vendor_id'], ['vendors.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute('DROP TYPE IF EXISTS vendordoctype')
    op.execute('DROP TYPE IF EXISTS documentstatus')
