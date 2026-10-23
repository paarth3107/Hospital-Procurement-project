"""staff password reset token

Self-service "Forgot password" for staff (2026-10-23) -- same JWT-backed
scheme as the vendor side (c1d8e5f03a47), "typ": "staff_reset".

Revision ID: d2e9f7a1b853
Revises: c1d8e5f03a47
Create Date: 2026-10-23 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2e9f7a1b853'
down_revision: Union[str, None] = 'c1d8e5f03a47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_accounts", sa.Column("password_reset_token", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("user_accounts", "password_reset_token")
