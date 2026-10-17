"""tender status SCHEDULED: approved with a future publish date, not yet live

Revision ID: 9678a4856df5
Revises: a3d7e9c45b12
Create Date: 2026-10-16 00:00:00.000000

Real bug, found 2026-10-16: a tender's Publish Date was captured at creation
and shown on the approval screen, but nothing ever read it -- approval
always flipped straight to Published regardless of it. An approved tender
with a future publish date now lands in this new status instead
(models/tender.py's TenderStatus docstring has the full explanation);
services/tender_publish.py's sweep is what moves it on to Published once
that date arrives.
"""
from alembic import op

revision = "9678a4856df5"
down_revision = "a3d7e9c45b12"
branch_labels = None
depends_on = None

_MYSQL_ENUM_WITH_SCHEDULED = "ENUM('DRAFT','PENDING_APPROVAL','SCHEDULED','PUBLISHED','WITHDRAWN','NO_AWARD','AWARDED')"
_MYSQL_ENUM_WITHOUT_SCHEDULED = "ENUM('DRAFT','PENDING_APPROVAL','PUBLISHED','WITHDRAWN','NO_AWARD','AWARDED')"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "mysql":
        # MySQL enums are inline column definitions, not a named type --
        # the whole allowed set is redeclared (app/init_db.py's note on why
        # this project's post-port migrations use raw SQL per dialect
        # rather than replaying the old Postgres-only history).
        op.execute(f"ALTER TABLE tenders MODIFY COLUMN status {_MYSQL_ENUM_WITH_SCHEDULED} NOT NULL DEFAULT 'DRAFT'")
    else:
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE tenderstatus ADD VALUE IF NOT EXISTS 'SCHEDULED'")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "mysql":
        # Pre-migration, nothing was ever Scheduled -- approval always
        # published immediately, so that's the honest fallback here.
        op.execute("UPDATE tenders SET status = 'PUBLISHED', published_at = NOW() WHERE status = 'SCHEDULED'")
        op.execute(f"ALTER TABLE tenders MODIFY COLUMN status {_MYSQL_ENUM_WITHOUT_SCHEDULED} NOT NULL DEFAULT 'DRAFT'")
    else:
        op.execute("UPDATE tenders SET status = 'PUBLISHED', published_at = now() WHERE status = 'SCHEDULED'")
    # Postgres can't drop an enum value; 'SCHEDULED' stays in the type.
