"""technical evaluation: per-evaluator scores, recorded results, line closing

Revision ID: c3f8a2d15e77
Revises: b7e2f4a91c30
"""
import sqlalchemy as sa
from alembic import op

revision = "c3f8a2d15e77"
down_revision = "b7e2f4a91c30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    decision = sa.Enum("QUALIFIED", "DISQUALIFIED", name="technicaldecision")
    op.create_table(
        "bid_evaluations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bid_id", sa.Integer(), sa.ForeignKey("bids.id"), nullable=False),
        sa.Column("evaluator_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=False),
        sa.Column("decision", decision, nullable=False),
        sa.Column("scores", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("weighted_score", sa.Float(), nullable=True),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("bid_id", "evaluator_id", name="uq_bid_evaluation_evaluator"),
    )
    op.create_index("ix_bid_evaluations_bid_id", "bid_evaluations", ["bid_id"])
    op.create_table(
        "bid_technical_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bid_id", sa.Integer(), sa.ForeignKey("bids.id"), nullable=False, unique=True),
        sa.Column("outcome", sa.Enum("QUALIFIED", "DISQUALIFIED", name="technicaldecision", create_type=False), nullable=False),
        sa.Column("consolidated_score", sa.Float(), nullable=True),
        sa.Column("t_rank", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.add_column("tender_line_items", sa.Column("technical_closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tender_line_items", sa.Column("technical_closed_by_id", sa.Integer(), sa.ForeignKey("user_accounts.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("tender_line_items", "technical_closed_by_id")
    op.drop_column("tender_line_items", "technical_closed_at")
    op.drop_table("bid_technical_results")
    op.drop_table("bid_evaluations")
    op.execute("DROP TYPE IF EXISTS technicaldecision")
