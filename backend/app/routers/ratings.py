from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user_account import Role, UserAccount
from app.models.vendor import Vendor
from app.models.vendor_rating import MATERIAL_CHANGE_THRESHOLD, RatingHistory, VendorRating
from app.schemas.rating import RatingHistoryOut, RatingManualUpdate, RatingOut
from app.security import get_current_user, require_role

router = APIRouter(prefix="/api/v1/ratings", tags=["ratings"])

MANUAL_FIELDS = ("on_time_pct", "quality_pct", "compliance_pct", "responsiveness")


def _get_or_create_rating(vendor_id: int, db: Session) -> VendorRating:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")

    rating = db.query(VendorRating).filter(VendorRating.vendor_id == vendor_id).first()
    if not rating:
        # Spec §5.3 point 5: a vendor with no rating history yet gets a
        # provisional/default score, not a missing row — created lazily on
        # first access rather than at vendor-approval time, since nothing
        # else about the rating depends on when the row itself appears.
        # Column defaults apply at INSERT, not at object construction — set
        # explicitly here since recompute_overall() needs a real number to
        # weight, not the column's not-yet-applied default.
        rating = VendorRating(vendor_id=vendor_id, price_competitiveness=50.0)
        rating.recompute_overall()
        db.add(rating)
        db.commit()
        db.refresh(rating)
    return rating


@router.get("/{vendor_id}", response_model=RatingOut)
def get_rating(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    return _get_or_create_rating(vendor_id, db)


@router.get("/{vendor_id}/history", response_model=list[RatingHistoryOut])
def get_rating_history(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    rating = _get_or_create_rating(vendor_id, db)
    return sorted(rating.history, key=lambda h: h.entered_at)


@router.patch("/{vendor_id}", response_model=RatingOut)
def update_rating(
    vendor_id: int,
    payload: RatingManualUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN)),
):
    """Spec §5.3.1 — routine manual entry of the four non-computed
    parameters by the Procurement Admin. `price_competitiveness` is
    deliberately not settable here: overriding it is a governed override
    (spec point 4), which routes through the override/approval engine
    (Phase 7, not built yet) rather than this ordinary data-entry endpoint."""

    rating = _get_or_create_rating(vendor_id, db)

    changes = {f: getattr(payload, f) for f in MANUAL_FIELDS if getattr(payload, f) is not None}
    if not changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No manual rating fields were provided")

    for field, new_value in changes.items():
        old_value = getattr(rating, field)
        material = old_value is not None and abs(new_value - old_value) >= MATERIAL_CHANGE_THRESHOLD
        if material and not (payload.comment and payload.comment.strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{field}' changed by more than {MATERIAL_CHANGE_THRESHOLD} points from its prior value "
                "— a comment is required",
            )
        db.add(
            RatingHistory(
                rating_id=rating.id,
                field=field,
                old_value=old_value,
                new_value=new_value,
                comment=payload.comment.strip() if payload.comment else None,
                entered_by_id=user.id,
            )
        )
        setattr(rating, field, new_value)

    rating.last_manual_update_at = datetime.now(timezone.utc)
    rating.recompute_overall()
    db.commit()
    db.refresh(rating)
    return rating
