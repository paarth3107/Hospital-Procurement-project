"""rename tenders.open_link_token -> guest_invite_token

Revision ID: f57aa7d36350
Revises: 0e4f7d79e6c9
Create Date: 2026-10-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "f57aa7d36350"
down_revision = "0e4f7d79e6c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("tenders", "open_link_token", new_column_name="guest_invite_token", existing_type=sa.String(255))


def downgrade() -> None:
    op.alter_column("tenders", "guest_invite_token", new_column_name="open_link_token", existing_type=sa.String(255))
