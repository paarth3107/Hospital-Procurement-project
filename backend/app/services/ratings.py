from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.product_master import ProcurementType
from app.models.vendor import Vendor
from app.models.vendor_rating import PriceCompetitivenessRecord, UNRATED_DEFAULT_SCORE, VendorRating

# The score a vendor with no rating row yet resolves to -- same
# UNRATED_DEFAULT_SCORE placeholder VendorRating.recompute_overall() uses
# for an existing row with nothing in it, so a "no row at all" vendor and a
# "row exists but is_unrated" vendor never show two different numbers for
# the same underlying situation. Lets callers read a score without
# persisting a row for every (vendor, type) pair.
DEFAULT_RATING_SCORE = UNRATED_DEFAULT_SCORE

# Spec §5.3: "a rolling window (e.g., trailing 12 months)" for the
# auto-computed Price Competitiveness sub-score -- illustrative, not a spec
# value, same footing as the other "e.g." numbers already in this module.
PRICE_COMPETITIVENESS_WINDOW_DAYS = 365


def get_or_create_rating(vendor_id: int, procurement_type: ProcurementType, db: Session) -> VendorRating:
    """A vendor holds one rating per procurement type (spec 4.3). Created
    lazily on first access as a provisional/default score (spec 5.3 point 5)."""

    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")

    rating = (
        db.query(VendorRating)
        .filter(VendorRating.vendor_id == vendor_id, VendorRating.procurement_type == procurement_type)
        .first()
    )
    if not rating:
        # No price_competitiveness set here (2026-10-23) -- a brand-new row
        # starts with nothing at all, same as its 4 manual siblings;
        # recompute_overall() correctly lands it on is_unrated=True,
        # overall_score=0.0 rather than fabricating a 50.
        rating = VendorRating(vendor_id=vendor_id, procurement_type=procurement_type)
        rating.recompute_overall()
        db.add(rating)
        db.commit()
        db.refresh(rating)
    return rating


def rating_score(vendor_id: int, procurement_type: ProcurementType, db: Session) -> float:
    """Read-only score lookup (no row is created). Thin wrapper over
    rating_score_detail() -- kept so every existing call site elsewhere
    (bid evaluation, commercial statements, ...) stays untouched; they just
    now see the real 0.0 sentinel instead of a fabricated 50.0 for a
    genuinely unrated vendor, which is correct there too."""

    return rating_score_detail(vendor_id, procurement_type, db)[0]


def rating_score_detail(vendor_id: int, procurement_type: ProcurementType, db: Session) -> tuple[float, bool]:
    """(score, is_unrated) -- eligibility.py needs the second half to tell
    "no evidence at all" apart from "a real, if low, computed score" when
    gating against a minimum rating or ranking under max_invites."""

    rating = (
        db.query(VendorRating)
        .filter(VendorRating.vendor_id == vendor_id, VendorRating.procurement_type == procurement_type)
        .first()
    )
    if not rating:
        return DEFAULT_RATING_SCORE, True
    return rating.overall_score, rating.is_unrated


def rating_scores(vendor_ids: list[int], procurement_type: ProcurementType, db: Session) -> dict[int, float]:
    """Batched form of rating_score() (2026-10-13, performance) -- one query
    for a whole set of vendors instead of one per vendor, for callers scoring
    every bid/invite on a line at once (evaluation/commercial statement
    screens). Same default-score fallback as the single-vendor version."""

    if not vendor_ids:
        return {}
    rows = (
        db.query(VendorRating)
        .filter(VendorRating.vendor_id.in_(vendor_ids), VendorRating.procurement_type == procurement_type)
        .all()
    )
    found = {r.vendor_id: r.overall_score for r in rows}
    return {vid: found.get(vid, DEFAULT_RATING_SCORE) for vid in vendor_ids}


def record_price_competitiveness(db: Session, vendor_id: int, procurement_type: ProcurementType, bid_id: int, line_item_id: int, price_score: float) -> None:
    """One row per bid (spec §5.2/§5.3's only system-computed sub-score),
    written once -- a bid's price and line don't change after the fact, so
    re-closing isn't possible (close_technical refuses a line that's already
    closed) and there's nothing to update if this were somehow called twice."""

    if db.query(PriceCompetitivenessRecord).filter(PriceCompetitivenessRecord.bid_id == bid_id).first():
        return
    db.add(
        PriceCompetitivenessRecord(
            vendor_id=vendor_id, procurement_type=procurement_type, bid_id=bid_id, tender_line_item_id=line_item_id, price_score=price_score
        )
    )


def refresh_price_competitiveness(db: Session, vendor_id: int, procurement_type: ProcurementType) -> VendorRating:
    """Recomputes a vendor's Price Competitiveness sub-score as the average
    of their price-competitiveness records within the rolling window (spec
    §5.3: "so old bid history ages out"), and folds it into the overall
    rating. A vendor with no records in the window goes back to null (spec
    §5.3 point 5: "Unrated" until enough history exists) -- recompute_overall()
    then excludes it from the weighted average entirely, rather than it
    being scored on stale or nonexistent data."""

    cutoff = datetime.now(timezone.utc) - timedelta(days=PRICE_COMPETITIVENESS_WINDOW_DAYS)
    scores = [
        s
        for (s,) in db.query(PriceCompetitivenessRecord.price_score)
        .filter(
            PriceCompetitivenessRecord.vendor_id == vendor_id,
            PriceCompetitivenessRecord.procurement_type == procurement_type,
            PriceCompetitivenessRecord.recorded_at >= cutoff,
        )
        .all()
    ]
    rating = get_or_create_rating(vendor_id, procurement_type, db)
    rating.price_competitiveness = round(sum(scores) / len(scores), 2) if scores else None
    rating.recompute_overall()
    db.add(rating)
    return rating
