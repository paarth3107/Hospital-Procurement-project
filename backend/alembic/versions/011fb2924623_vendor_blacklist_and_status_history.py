"""vendor blacklist and status history

Revision ID: 011fb2924623
Revises: 20536ccbcf69
Create Date: 2026-09-24 16:17:49.133615

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '011fb2924623'
down_revision: Union[str, None] = '20536ccbcf69'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE vendorstatus ADD VALUE IF NOT EXISTS 'BLACKLISTED'")
    vendor_status = postgresql.ENUM(
        'DRAFT', 'PENDING_VERIFICATION', 'INFO_REQUESTED', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'BLACKLISTED',
        name='vendorstatus', create_type=False,
    )
    op.create_table(
        'vendor_status_history',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('vendor_id', sa.Integer(), sa.ForeignKey('vendors.id'), nullable=False),
        sa.Column('from_status', vendor_status, nullable=True),
        sa.Column('to_status', vendor_status, nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('actor_id', sa.Integer(), nullable=True),
        sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    )
    op.create_index('ix_vendor_status_history_vendor_id', 'vendor_status_history', ['vendor_id'])
    # Existing vendors get one row recording the status they're in now.
    op.execute("""
        INSERT INTO vendor_status_history (vendor_id, from_status, to_status, reason, actor_id, at)
        SELECT id, NULL, status, 'Status at the time history tracking began', decided_by_id, COALESCE(decided_at, created_at)
        FROM vendors
    """)


def downgrade() -> None:
    op.drop_index('ix_vendor_status_history_vendor_id', table_name='vendor_status_history')
    op.drop_table('vendor_status_history')
    # PostgreSQL can't drop an enum value; 'BLACKLISTED' stays in the type.
