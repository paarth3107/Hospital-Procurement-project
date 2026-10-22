"""vendor expedited review columns

Spec §6.7/§12.3's "Expedited Registration Review" (OverrideType.
GUEST_VENDOR_INVITE, wired in routers/vendors.py) -- purely informational
flag set once that override is Approved, never cleared.

Revision ID: 102cef39c690
Revises: e8b2f6a4c913
Create Date: 2026-10-22 11:03:48.189786

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '102cef39c690'
down_revision: Union[str, None] = 'e8b2f6a4c913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("vendors", sa.Column("expedited_review_tender_id", sa.Integer(), nullable=True))
    op.add_column("vendors", sa.Column("expedited_review_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_vendors_expedited_review_tender_id", "vendors", "tenders", ["expedited_review_tender_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_vendors_expedited_review_tender_id", "vendors", type_="foreignkey")
    op.drop_column("vendors", "expedited_review_requested_at")
    op.drop_column("vendors", "expedited_review_tender_id")
