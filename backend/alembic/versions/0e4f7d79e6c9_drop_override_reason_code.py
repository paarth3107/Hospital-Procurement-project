"""drop override reason_code

Removes the override engine's reason_code concept altogether (user-directed,
2026-10-26): OverrideRequest.reason_code was a short categorization code
alongside the free-text justification every governed override already
requires -- every request path (price competitiveness override, invite list
manual add, late-submission exception, due-date extension, technical score
correction) collected one, and it was never surfaced anywhere more useful
than the justification wasn't already. justification remains the sole
reason field everywhere; the generic ExpeditedReviewRequest.reason_code
(Vendor Registration's expedited-review flag, which never became a real
OverrideRequest -- see CLAUDE.md) carried the same vestigial field and was
dropped alongside it in code, but that one was never a DB column.

Revision ID: 0e4f7d79e6c9
Revises: c4a8e1f93b6d
Create Date: 2026-10-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0e4f7d79e6c9"
down_revision = "c4a8e1f93b6d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("override_requests", "reason_code")


def downgrade() -> None:
    op.add_column("override_requests", sa.Column("reason_code", sa.String(255), nullable=True))
    op.execute("UPDATE override_requests SET reason_code = 'unspecified' WHERE reason_code IS NULL")
    op.alter_column("override_requests", "reason_code", existing_type=sa.String(255), nullable=False)
