"""tender line published flag

Revision ID: 20536ccbcf69
Revises: 9c8a97ab95c7
Create Date: 2026-09-24 14:56:14.647237

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20536ccbcf69'
down_revision: Union[str, None] = '9c8a97ab95c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tender_line_items', sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()))
    # Lines of already-published tenders that have invites were effectively published.
    op.execute("""
        UPDATE tender_line_items SET published = true
        WHERE tender_id IN (SELECT id FROM tenders WHERE status = 'PUBLISHED')
          AND id IN (SELECT tender_line_item_id FROM tender_invites)
    """)


def downgrade() -> None:
    op.drop_column('tender_line_items', 'published')
