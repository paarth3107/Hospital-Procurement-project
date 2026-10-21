"""bid status PENDING_LATE_EXCEPTION: a late submission held, not rejected

Revision ID: c2f6a81de937
Revises: bab61704be0a
Create Date: 2026-10-21 00:00:00.000000

Spec §8.4's governed late-submission exception: a bid submitted after the
tender's bid_due_date is now accepted (app/services/bids.py's
assert_can_bid(allow_late=...)) and held in this new status instead of
being rejected outright at the API boundary. It only ever becomes SUBMITTED
if a Category Manager (or escalated Approving Authority) approves the
override request (app/routers/tenders.py); staying rejected just means
staying in this status, excluded from every BidStatus.SUBMITTED filter with
no further code changes needed.
"""
from alembic import op

revision = "c2f6a81de937"
down_revision = "bab61704be0a"
branch_labels = None
depends_on = None

_MYSQL_ENUM_WITH_PENDING_LATE = "ENUM('DRAFT','SUBMITTED','WITHDRAWN','PENDING_LATE_EXCEPTION')"
_MYSQL_ENUM_WITHOUT_PENDING_LATE = "ENUM('DRAFT','SUBMITTED','WITHDRAWN')"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "mysql":
        op.execute(f"ALTER TABLE bids MODIFY COLUMN status {_MYSQL_ENUM_WITH_PENDING_LATE} NOT NULL DEFAULT 'DRAFT'")
    else:
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE bidstatus ADD VALUE IF NOT EXISTS 'PENDING_LATE_EXCEPTION'")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "mysql":
        # Pre-migration, a late submission was simply rejected at the API
        # boundary -- nothing was ever persisted in this status, but fall
        # back to WITHDRAWN (excluded from evaluation) just in case any row
        # exists, rather than leaving an enum value the column no longer allows.
        op.execute("UPDATE bids SET status = 'WITHDRAWN' WHERE status = 'PENDING_LATE_EXCEPTION'")
        op.execute(f"ALTER TABLE bids MODIFY COLUMN status {_MYSQL_ENUM_WITHOUT_PENDING_LATE} NOT NULL DEFAULT 'DRAFT'")
    else:
        op.execute("UPDATE bids SET status = 'WITHDRAWN' WHERE status = 'PENDING_LATE_EXCEPTION'")
    # Postgres can't drop an enum value; 'PENDING_LATE_EXCEPTION' stays in the type.
