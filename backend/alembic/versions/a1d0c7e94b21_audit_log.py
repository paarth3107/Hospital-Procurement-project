"""immutable audit log, with a one-time backfill of the existing history tables

Revision ID: a1d0c7e94b21
Revises: 37e3f4c7b505
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a1d0c7e94b21"
down_revision = "37e3f4c7b505"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_type", sa.String(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("actor_name", sa.String(), nullable=True),
        sa.Column("actor_role", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("entity_label", sa.String(), nullable=True),
        sa.Column("facility_id", sa.Integer(), sa.ForeignKey("facilities.id"), nullable=True),
        sa.Column("before_state", postgresql.JSONB(), nullable=True),
        sa.Column("after_state", postgresql.JSONB(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("meta", postgresql.JSONB(), nullable=True),
        sa.Column("imported", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_audit_log_action", "audit_log", ["action"])
    op.create_index("ix_audit_log_occurred_at", "audit_log", ["occurred_at"])
    op.create_index("ix_audit_log_entity", "audit_log", ["entity_type", "entity_id"])
    op.create_index("ix_audit_log_actor", "audit_log", ["actor_type", "actor_id"])

    # Backfill first (needs INSERT), then lock the table down.
    _backfill()

    op.execute(
        """
        CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_log is insert-only: % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();")
    op.execute("CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;")
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log;")
    op.execute("DROP FUNCTION IF EXISTS audit_log_immutable();")
    op.drop_table("audit_log")


def _backfill() -> None:
    """Copies the pre-audit-log history into audit_log, marked imported=true.
    Enum columns store the member NAME in Postgres (upper case); the app's
    values are lower case, hence lower(...::text)."""

    # Vendor status history (registration, KYC decisions, suspensions...).
    op.execute(
        """
        INSERT INTO audit_log (occurred_at, actor_type, actor_id, actor_name, actor_role, action, entity_type, entity_id,
                               entity_label, before_state, after_state, reason, imported)
        SELECT h.at,
               CASE WHEN h.actor_id IS NOT NULL THEN 'staff' WHEN h.from_status IS NULL THEN 'vendor' ELSE 'system' END,
               COALESCE(h.actor_id, CASE WHEN h.from_status IS NULL THEN h.vendor_id END),
               CASE WHEN h.actor_id IS NOT NULL THEN u.full_name WHEN h.from_status IS NULL THEN v.legal_name ELSE 'System' END,
               CASE WHEN h.actor_id IS NOT NULL THEN lower(u.role::text) WHEN h.from_status IS NULL THEN 'vendor' END,
               CASE WHEN h.from_status IS NULL THEN 'vendor.registered' ELSE 'vendor.status_changed' END,
               'vendor', h.vendor_id, v.legal_name,
               CASE WHEN h.from_status IS NULL THEN NULL ELSE jsonb_build_object('status', lower(h.from_status::text)) END,
               jsonb_build_object('status', lower(h.to_status::text)),
               h.reason, true
        FROM vendor_status_history h
        JOIN vendors v ON v.id = h.vendor_id
        LEFT JOIN user_accounts u ON u.id = h.actor_id;
        """
    )

    # Vendor mapping history.
    op.execute(
        """
        INSERT INTO audit_log (occurred_at, actor_type, actor_id, actor_name, actor_role, action, entity_type, entity_id,
                               entity_label, before_state, after_state, reason, imported)
        SELECT h.at,
               CASE WHEN h.actor_id IS NOT NULL THEN 'staff' WHEN h.from_state IS NULL THEN 'vendor' ELSE 'system' END,
               COALESCE(h.actor_id, CASE WHEN h.from_state IS NULL THEN m.vendor_id END),
               CASE WHEN h.actor_id IS NOT NULL THEN u.full_name WHEN h.from_state IS NULL THEN v.legal_name ELSE 'System' END,
               CASE WHEN h.actor_id IS NOT NULL THEN lower(u.role::text) WHEN h.from_state IS NULL THEN 'vendor' END,
               CASE WHEN h.from_state IS NULL THEN 'mapping.requested'
                    WHEN h.from_state = 'SUSPENDED' AND h.to_state = 'APPROVED' THEN 'mapping.reinstated'
                    ELSE 'mapping.' || lower(h.to_state::text) END,
               'mapping', h.mapping_id,
               v.legal_name || ' — ' || COALESCE(p.name, c.name),
               CASE WHEN h.from_state IS NULL THEN NULL ELSE jsonb_build_object('state', lower(h.from_state::text)) END,
               jsonb_build_object('state', lower(h.to_state::text)),
               h.reason, true
        FROM vendor_mapping_history h
        JOIN vendor_mappings m ON m.id = h.mapping_id
        JOIN vendors v ON v.id = m.vendor_id
        LEFT JOIN product_master p ON p.id = m.product_master_id
        LEFT JOIN product_categories c ON c.id = m.category_id
        LEFT JOIN user_accounts u ON u.id = h.actor_id;
        """
    )

    # Manual rating entries.
    op.execute(
        """
        INSERT INTO audit_log (occurred_at, actor_type, actor_id, actor_name, actor_role, action, entity_type, entity_id,
                               entity_label, before_state, after_state, reason, imported)
        SELECT h.entered_at,
               CASE WHEN h.entered_by_id IS NULL THEN 'system' ELSE 'staff' END,
               h.entered_by_id,
               COALESCE(u.full_name, 'System'),
               lower(u.role::text),
               'rating.manual_entry', 'rating', h.rating_id,
               v.legal_name || ' — ' || lower(r.procurement_type::text),
               jsonb_build_object(h.field, h.old_value),
               jsonb_build_object(h.field, h.new_value),
               h.comment, true
        FROM rating_history h
        JOIN vendor_ratings r ON r.id = h.rating_id
        JOIN vendors v ON v.id = r.vendor_id
        LEFT JOIN user_accounts u ON u.id = h.entered_by_id;
        """
    )

    # Tender approval rounds: one event for the submission, one for the decision.
    op.execute(
        """
        INSERT INTO audit_log (occurred_at, actor_type, actor_id, actor_name, actor_role, action, entity_type, entity_id,
                               entity_label, facility_id, meta, imported)
        SELECT r.submitted_at,
               CASE WHEN r.submitted_by_id IS NULL THEN 'system' ELSE 'staff' END,
               r.submitted_by_id, COALESCE(u.full_name, 'System'), lower(u.role::text),
               'tender.submitted_for_approval', 'tender', r.tender_id, t.title, t.facility_id,
               jsonb_build_object('round_number', r.round_number, 'required_tier', r.required_tier), true
        FROM tender_approval_rounds r
        JOIN tenders t ON t.id = r.tender_id
        LEFT JOIN user_accounts u ON u.id = r.submitted_by_id;
        """
    )
    op.execute(
        """
        INSERT INTO audit_log (occurred_at, actor_type, actor_id, actor_name, actor_role, action, entity_type, entity_id,
                               entity_label, facility_id, reason, meta, imported)
        SELECT r.decided_at,
               CASE WHEN r.reviewer_id IS NULL THEN 'system' ELSE 'staff' END,
               r.reviewer_id, COALESCE(u.full_name, 'System'), lower(u.role::text),
               'tender.' || lower(r.decision::text), 'tender', r.tender_id, t.title, t.facility_id,
               r.comments,
               jsonb_build_object('round_number', r.round_number, 'required_tier', r.required_tier), true
        FROM tender_approval_rounds r
        JOIN tenders t ON t.id = r.tender_id
        LEFT JOIN user_accounts u ON u.id = r.reviewer_id
        WHERE r.decision <> 'PENDING' AND r.decided_at IS NOT NULL;
        """
    )
