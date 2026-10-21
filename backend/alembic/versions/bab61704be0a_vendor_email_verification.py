"""vendor email verification code/expiry/verified-at

Revision ID: bab61704be0a
Revises: 9678a4856df5
Create Date: 2026-10-19 00:00:00.000000

Real gap, found 2026-10-19: email format validation (schemas/vendor.py's
EmailStr) only checks the string looks like an email, never that the
registrant actually controls that inbox. A 6-digit code sent before Step 2
(routers/vendors.py's send_verification_code/verify_email_code) closes that;
these three columns are its state.
"""
from alembic import op
import sqlalchemy as sa

revision = "bab61704be0a"
down_revision = "9678a4856df5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vendors", sa.Column("email_verification_code", sa.String(length=6), nullable=True))
    op.add_column("vendors", sa.Column("email_verification_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("vendors", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("vendors", "email_verified_at")
    op.drop_column("vendors", "email_verification_expires_at")
    op.drop_column("vendors", "email_verification_code")
