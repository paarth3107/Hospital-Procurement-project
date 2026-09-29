"""vendor website and alternate address

Revision ID: d2e4f6a8b0c2
Revises: c1a2b3d4e5f6
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2e4f6a8b0c2'
down_revision: Union[str, None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Both optional, user-directed additions: a second/alternate address
    # (correspondence, billing...) distinct from the registered address, and
    # the vendor's website. Nullable for existing vendors and new ones alike.
    op.add_column('vendors', sa.Column('alternate_address', sa.Text(), nullable=True))
    op.add_column('vendors', sa.Column('website', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('vendors', 'website')
    op.drop_column('vendors', 'alternate_address')
