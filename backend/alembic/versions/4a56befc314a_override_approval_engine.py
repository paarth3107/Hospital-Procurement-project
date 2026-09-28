"""manual override & exception approval workflow engine (spec 12) -- generic
engine skeleton: no override type is wired into a real target-record mutation
yet, see backend/README.md.

Revision ID: 4a56befc314a
Revises: b6d4f18a2c73
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "4a56befc314a"
down_revision = "b6d4f18a2c73"
branch_labels = None
depends_on = None

# SQLAlchemy's Enum column stores a Python enum member's NAME, not its
# .value, unless told otherwise -- the existing "role" pg enum type already
# holds uppercase names the same way (checked directly: user_accounts.role
# rows are 'PROCUREMENT_ADMIN' etc, not 'procurement_admin'), so these match
# that established convention rather than introduce a second one.
OVERRIDE_TYPE = postgresql.ENUM(
    "PRICE_COMPETITIVENESS_OVERRIDE",
    "INVITE_LIST_MANUAL_ADD",
    "GUEST_VENDOR_INVITE",
    "TECHNICAL_SCORE_CORRECTION",
    "LATE_SUBMISSION_EXCEPTION",
    "DUE_DATE_EXTENSION",
    "NON_L1_AWARD_OVERRIDE",
    "PO_REEXPORT",
    name="overridetype",
    create_type=False,
)
OVERRIDE_STATUS = postgresql.ENUM(
    "REQUESTED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ESCALATED", "EXPIRED",
    name="overridestatus",
    create_type=False,
)
ROLE = postgresql.ENUM(
    "procurement_officer", "procurement_admin", "category_manager", "approving_authority", "system_admin",
    name="role", create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    OVERRIDE_TYPE.create(bind, checkfirst=True)
    OVERRIDE_STATUS.create(bind, checkfirst=True)

    op.create_table(
        "override_type_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("override_type", OVERRIDE_TYPE, nullable=False),
        sa.Column("default_approver_role", ROLE, nullable=False),
        sa.Column("default_approver_min_tier", sa.Integer(), nullable=True),
        sa.Column("self_attested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("escalate_to_role", ROLE, nullable=True),
        sa.Column("escalate_to_min_tier", sa.Integer(), nullable=True),
        sa.Column("escalation_threshold", sa.Float(), nullable=True),
        sa.Column("sla_hours", sa.Integer(), nullable=True),
        sa.UniqueConstraint("override_type", name="uq_override_type_configs_type"),
    )

    op.create_table(
        "override_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("override_type", OVERRIDE_TYPE, nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("entity_label", sa.String(), nullable=True),
        sa.Column("facility_id", sa.Integer(), sa.ForeignKey("facilities.id"), nullable=True),
        sa.Column("initiator_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=False),
        sa.Column("initiator_role", ROLE, nullable=False),
        sa.Column("reason_code", sa.String(), nullable=False),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("proposed_change", postgresql.JSONB(), nullable=True),
        sa.Column("status", OVERRIDE_STATUS, nullable=False, server_default="PENDING_APPROVAL"),
        sa.Column("escalation_level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("required_approver_role", ROLE, nullable=True),
        sa.Column("required_approver_min_tier", sa.Integer(), nullable=True),
        sa.Column("sla_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_override_requests_override_type", "override_requests", ["override_type"])
    op.create_index("ix_override_requests_status", "override_requests", ["status"])


def downgrade() -> None:
    op.drop_table("override_requests")
    op.drop_table("override_type_configs")
    OVERRIDE_STATUS.drop(op.get_bind(), checkfirst=True)
    OVERRIDE_TYPE.drop(op.get_bind(), checkfirst=True)
