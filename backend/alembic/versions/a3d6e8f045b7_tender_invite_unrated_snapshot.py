"""tender invite unrated-at-resolution snapshot

Snapshots EligibleVendor.is_unrated (f7b3c9e1d204) onto each TenderInvite at
the moment it's resolved -- without it, a vendor who had zero rating
history when invited (only reachable when the line's threshold is 0) shows
a bare "0" on the E-Tender/L1 Approval review screen, indistinguishable
from a real, poor score. Existing rows default to false (we genuinely can't
know their resolution-time state retroactively; false is the honest "don't
know, so don't claim Unrated" choice, same reasoning as other irreversible
backfills in this project, e.g. e8b2f6a4c913's role migration).

Revision ID: a3d6e8f045b7
Revises: f7b3c9e1d204
Create Date: 2026-10-23 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "a3d6e8f045b7"
down_revision = "f7b3c9e1d204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tender_invites", sa.Column("is_unrated_at_resolution", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column("tender_invites", "is_unrated_at_resolution", server_default=None)


def downgrade() -> None:
    op.drop_column("tender_invites", "is_unrated_at_resolution")
