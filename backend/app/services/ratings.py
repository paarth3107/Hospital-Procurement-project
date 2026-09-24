from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.product_master import ProcurementType
from app.models.vendor import Vendor
from app.models.vendor_rating import VendorRating

# The score a vendor with no rating row yet resolves to (only
# price_competitiveness=50.0 set, nothing else) -- see
# VendorRating.recompute_overall(). Lets callers read a score without
# persisting a row for every (vendor, type) pair.
DEFAULT_RATING_SCORE = 50.0


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
