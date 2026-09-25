"""tender status NO_AWARD: every line was left out, so nothing was awarded

Revision ID: f8c2a5d19b36
Revises: e5b7d3a08f14
"""
from alembic import op

revision = "f8c2a5d19b36"
down_revision = "e5b7d3a08f14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tenderstatus ADD VALUE IF NOT EXISTS 'NO_AWARD'")
    # Tenders already finalised with no line actually awarded were labelled Awarded.
    op.execute(
        """
        UPDATE tenders SET status = 'NO_AWARD'
        WHERE status = 'AWARDED' AND NOT EXISTS (
            SELECT 1 FROM award_rounds r JOIN tender_line_items l ON l.id = r.line_item_id
            WHERE l.tender_id = tenders.id AND r.status = 'approved' AND r.kind = 'award')
        """
    )


def downgrade() -> None:
    op.execute("UPDATE tenders SET status = 'AWARDED' WHERE status = 'NO_AWARD'")
