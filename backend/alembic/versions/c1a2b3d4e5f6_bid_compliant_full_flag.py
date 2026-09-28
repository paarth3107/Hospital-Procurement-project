"""bid compliant_full flag

Revision ID: c1a2b3d4e5f6
Revises: 4a56befc314a
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, None] = '4a56befc314a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing bids default to false (not yet confirmed fully compliant); any
    # prose they already wrote under the old single-textarea form stays put in
    # technical_compliance, now read as their deviations/notes text.
    op.add_column('bids', sa.Column('compliant_full', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('bids', 'compliant_full')
