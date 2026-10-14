"""vendor registration token (incremental per-document registration)

Revision ID: a3d7e9c45b12
Revises: f7c9a2e6b104
Create Date: 2026-10-13 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "a3d7e9c45b12"
down_revision = "f7c9a2e6b104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendors", sa.Column("registration_token", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "registration_token")
