"""staff notifications

A short, informational message to a staff user -- first use (2026-10-22,
user-directed) is telling an override's initiator once it's approved or
rejected (app/services/overrides.py's approve_override()/reject_override()).

Revision ID: fcc1c9a470ba
Revises: 102cef39c690
Create Date: 2026-10-22 15:21:34.523888

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fcc1c9a470ba'
down_revision: Union[str, None] = '102cef39c690'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "staff_notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=False),
        sa.Column("kind", sa.String(255), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_staff_notifications_user_id", "staff_notifications", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_staff_notifications_user_id", table_name="staff_notifications")
    op.drop_table("staff_notifications")
