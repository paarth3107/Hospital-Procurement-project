"""data-only: tender_invites.source 'guest' -> 'manual'

Revision ID: d913e5c47a02
Revises: c2f6a81de937
Create Date: 2026-10-21 00:05:00.000000

Naming correction, found 2026-10-21: what the code called "Guest Invite"
(source="guest") is actually spec §6.6 (an officer manually adding an
already-Active vendor an line the eligibility rules didn't select) -- not
spec §6.7's "Guest Invite", a different, unimplemented feature about a
vendor with no existing profile at all (see CLAUDE.md). The column is a
plain String(255), not a DB-level enum, so no DDL is needed -- just
backfilling any existing rows so nothing in the live DB keeps the old value
going forward.
"""
from alembic import op

revision = "d913e5c47a02"
down_revision = "c2f6a81de937"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE tender_invites SET source = 'manual' WHERE source = 'guest'")


def downgrade() -> None:
    op.execute("UPDATE tender_invites SET source = 'guest' WHERE source = 'manual'")
