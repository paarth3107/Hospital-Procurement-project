"""remove rating provisional state, tighten unrated cutoff

There is no separate "Provisional" state anymore (2026-10-23, user-directed,
matching E-Procurement-Spec-v2.md:244 exactly) -- drops `vendor_ratings.
is_provisional`. Also tightens `is_unrated`'s cutoff to the spec's actual
"both conditions" wording (real price history AND at least one manual entry,
not just any single field) and resets the Unrated placeholder score from the
71.0 earlier-in-the-day trial value back to 50.0 (user-directed, same day) --
backfills every existing row's overall_score/is_unrated to match the new
rule, mirroring VendorRating.recompute_overall()'s own logic.

Revision ID: b9e2f4c817a3
Revises: a3d6e8f045b7
Create Date: 2026-10-23 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "b9e2f4c817a3"
down_revision = "a3d6e8f045b7"
branch_labels = None
depends_on = None

UNRATED_DEFAULT_SCORE = 50.0
RATING_WEIGHTS = {
    "price_competitiveness": 0.20,
    "on_time_pct": 0.25,
    "quality_pct": 0.25,
    "compliance_pct": 0.15,
    "responsiveness": 0.15,
}


def upgrade() -> None:
    conn = op.get_bind()
    ratings = sa.table(
        "vendor_ratings",
        sa.column("id", sa.Integer()),
        sa.column("price_competitiveness", sa.Float()),
        sa.column("on_time_pct", sa.Float()),
        sa.column("quality_pct", sa.Float()),
        sa.column("compliance_pct", sa.Float()),
        sa.column("responsiveness", sa.Float()),
        sa.column("overall_score", sa.Float()),
        sa.column("is_unrated", sa.Boolean()),
    )

    rows = conn.execute(
        sa.text(
            "SELECT id, price_competitiveness, on_time_pct, quality_pct, compliance_pct, responsiveness "
            "FROM vendor_ratings"
        )
    ).fetchall()

    for rid, price, on_time, quality, compliance, responsiveness in rows:
        available = {}
        if price is not None:
            available["price_competitiveness"] = price
        for field, value in (
            ("on_time_pct", on_time),
            ("quality_pct", quality),
            ("compliance_pct", compliance),
            ("responsiveness", responsiveness),
        ):
            if value is not None:
                available[field] = value

        has_manual = any(f in available for f in ("on_time_pct", "quality_pct", "compliance_pct", "responsiveness"))
        is_unrated = not (price is not None and has_manual)

        if is_unrated:
            overall_score = UNRATED_DEFAULT_SCORE
        else:
            total_weight = sum(RATING_WEIGHTS[f] for f in available)
            overall_score = sum(RATING_WEIGHTS[f] * v for f, v in available.items()) / total_weight

        conn.execute(
            ratings.update().where(ratings.c.id == rid).values(overall_score=overall_score, is_unrated=is_unrated)
        )

    op.drop_column("vendor_ratings", "is_provisional")


def downgrade() -> None:
    op.add_column("vendor_ratings", sa.Column("is_provisional", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.alter_column("vendor_ratings", "is_provisional", server_default=None)
