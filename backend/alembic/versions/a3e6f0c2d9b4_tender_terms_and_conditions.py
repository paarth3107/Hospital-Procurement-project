"""tender terms and conditions (spec 6.2)

Revision ID: a3e6f0c2d9b4
Revises: f8c2a5d19b36
"""
import sqlalchemy as sa
from alembic import op

revision = "a3e6f0c2d9b4"
down_revision = "f8c2a5d19b36"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenders", sa.Column("terms_and_conditions", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenders", "terms_and_conditions")
