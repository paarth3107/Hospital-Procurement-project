"""vendor rating real "unrated" state

price_competitiveness becomes nullable, like the 4 manual sub-scores it sits
alongside in VendorRating.recompute_overall()'s existing reweight logic --
it used to be the one sub-score that could never be absent (NOT NULL,
default 50.0), so a brand-new vendor with zero real history still got a
100%-weighted, fabricated 50 instead of the same "exclude what's missing,
re-normalize the rest" treatment the other 4 fields already receive.
Adds `is_unrated` (true only when ALL 5 sub-scores are absent -- a vendor
with literally nothing to judge them on yet, spec §5.3 point 5: "Unrated"
until enough history exists). Backfills every existing row to the new
semantics: price_competitiveness nulled out where there's no real
PriceCompetitivenessRecord in the rolling 12-month window, then
overall_score/is_provisional/is_unrated recomputed the same way
recompute_overall() does (duplicated here in plain SQL/Python rather than
importing app models into the migration, matching this project's existing
migration style).

Revision ID: f7b3c9e1d204
Revises: d2e9f7a1b853
Create Date: 2026-10-23 14:00:00.000000

"""
from datetime import datetime, timedelta, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f7b3c9e1d204"
down_revision = "d2e9f7a1b853"
branch_labels = None
depends_on = None

RATING_WEIGHTS = {
    "price_competitiveness": 0.20,
    "on_time_pct": 0.25,
    "quality_pct": 0.25,
    "compliance_pct": 0.15,
    "responsiveness": 0.15,
}
PRICE_COMPETITIVENESS_WINDOW_DAYS = 365


def upgrade() -> None:
    op.alter_column("vendor_ratings", "price_competitiveness", existing_type=sa.Float(), nullable=True)
    op.add_column("vendor_ratings", sa.Column("is_unrated", sa.Boolean(), nullable=False, server_default=sa.false()))

    conn = op.get_bind()
    ratings = sa.table(
        "vendor_ratings",
        sa.column("id", sa.Integer()),
        sa.column("price_competitiveness", sa.Float()),
        sa.column("overall_score", sa.Float()),
        sa.column("is_provisional", sa.Boolean()),
        sa.column("is_unrated", sa.Boolean()),
    )

    cutoff = datetime.now(timezone.utc) - timedelta(days=PRICE_COMPETITIVENESS_WINDOW_DAYS)
    rows = conn.execute(
        sa.text(
            "SELECT id, vendor_id, procurement_type, on_time_pct, quality_pct, compliance_pct, responsiveness "
            "FROM vendor_ratings"
        )
    ).fetchall()

    for rid, vendor_id, ptype, on_time, quality, compliance, responsiveness in rows:
        avg_score = conn.execute(
            sa.text(
                "SELECT AVG(price_score) FROM price_competitiveness_records "
                "WHERE vendor_id = :vid AND procurement_type = :pt AND recorded_at >= :cutoff"
            ),
            {"vid": vendor_id, "pt": ptype, "cutoff": cutoff},
        ).scalar()
        new_price = round(float(avg_score), 2) if avg_score is not None else None

        available = {}
        if new_price is not None:
            available["price_competitiveness"] = new_price
        for field, value in (
            ("on_time_pct", on_time),
            ("quality_pct", quality),
            ("compliance_pct", compliance),
            ("responsiveness", responsiveness),
        ):
            if value is not None:
                available[field] = value

        total_weight = sum(RATING_WEIGHTS[f] for f in available)
        if total_weight == 0:
            overall_score, is_provisional, is_unrated = 0.0, True, True
        else:
            overall_score = sum(RATING_WEIGHTS[f] * v for f, v in available.items()) / total_weight
            is_provisional = len(available) < len(RATING_WEIGHTS)
            is_unrated = False

        conn.execute(
            ratings.update()
            .where(ratings.c.id == rid)
            .values(price_competitiveness=new_price, overall_score=overall_score, is_provisional=is_provisional, is_unrated=is_unrated)
        )

    op.alter_column("vendor_ratings", "is_unrated", server_default=None)


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE vendor_ratings SET price_competitiveness = 50.0 WHERE price_competitiveness IS NULL"))
    op.alter_column("vendor_ratings", "price_competitiveness", existing_type=sa.Float(), nullable=False)
    op.drop_column("vendor_ratings", "is_unrated")
