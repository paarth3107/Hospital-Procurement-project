"""add entity_type/entity_id to staff_notifications

Revision ID: b3f6c8d1a7e2
Revises: f57aa7d36350
Create Date: 2026-10-29 00:00:00.000000

Lets a staff notification point at the specific record it's about (first
use: tender_approved/tender_rejected, 2026-10-29 user-directed), so the
notification bell can navigate there directly instead of just dismissing.
Nullable -- existing rows (override_approved/override_rejected) have
nothing to point at.
"""
from alembic import op
import sqlalchemy as sa

revision = "b3f6c8d1a7e2"
down_revision = "f57aa7d36350"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("staff_notifications", sa.Column("entity_type", sa.String(50), nullable=True))
    op.add_column("staff_notifications", sa.Column("entity_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("staff_notifications", "entity_id")
    op.drop_column("staff_notifications", "entity_type")
