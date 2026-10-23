"""vendor password reset token becomes a jwt

Widens Vendor.password_reset_token to fit a real signed JWT (was sized for
a 43-char secrets.token_urlsafe string) and drops password_reset_expires_at --
expiry now lives in the token's own "exp" claim (security.py's
create_password_reset_token/decode_password_reset_token), not a parallel
DB column that could drift out of sync with it.

Revision ID: c1d8e5f03a47
Revises: b4a7c6e9f012
Create Date: 2026-10-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d8e5f03a47'
down_revision: Union[str, None] = 'b4a7c6e9f012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("vendors", "password_reset_token", type_=sa.String(length=512), existing_type=sa.String(length=64))
    op.drop_column("vendors", "password_reset_expires_at")


def downgrade() -> None:
    op.add_column("vendors", sa.Column("password_reset_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("vendors", "password_reset_token", type_=sa.String(length=64), existing_type=sa.String(length=512))
