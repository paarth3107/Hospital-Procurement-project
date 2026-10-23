"""vendor password reset columns

Self-service "Forgot password" for vendors (2026-10-23) -- a capability
token + expiry proving the browser following an emailed reset link is the
one that link was actually sent to.

Revision ID: b4a7c6e9f012
Revises: fcc1c9a470ba
Create Date: 2026-10-23 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4a7c6e9f012'
down_revision: Union[str, None] = 'fcc1c9a470ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("vendors", sa.Column("password_reset_token", sa.String(length=64), nullable=True))
    op.add_column("vendors", sa.Column("password_reset_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "password_reset_expires_at")
    op.drop_column("vendors", "password_reset_token")
