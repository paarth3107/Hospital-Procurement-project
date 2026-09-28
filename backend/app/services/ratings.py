from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.product_master import ProcurementType
from app.models.vendor import Vendor
from app.models.vendor_rating import PriceCompetitivenessRecord, VendorRating

# The score a vendor with no rating row yet resolves to (only
# price_competitiveness=50.0 set, nothing else) -- see
# VendorRating.recompute_overall(). Lets callers read a score without
# persisting a row for every (vendor, type) pair.
DEFAULT_RATING_SCORE = 50.0

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
        # Column defaults apply at INSERT, not at object construction -- set
        # explicitly since recompute_overall() needs a real number to weight.
        rating = VendorRating(vendor_id=vendor_id, procurement_type=procurement_type, price_competitiveness=50.0)
        rating.recompute_overall()
        db.add(rating)
        db.commit()
        db.refresh(rating)
    return rating


def rating_score(vendor_id: int, procurement_type: ProcurementType, db: Session) -> float:
    """Read-only score lookup (no row is created)."""

    rating = (
        db.query(VendorRating)
        .filter(VendorRating.vendor_id == vendor_id, VendorRating.procurement_type == procurement_type)
        .first()
    )
    return rating.overall_score if rating else DEFAULT_RATING_SCORE


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
    rating. A vendor with no records in the window keeps the provisional
    default (spec §5.3 point 5: "Unrated" until enough history exists) rather
    than being scored on stale or nonexistent data."""

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
    rating.price_competitiveness = round(sum(scores) / len(scores), 2) if scores else 50.0
    rating.recompute_overall()
    db.add(rating)
    return rating
