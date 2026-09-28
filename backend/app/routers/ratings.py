from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.override import OverrideRequest, OverrideStatus, OverrideType
from app.models.user_account import Role, UserAccount
from app.models.product_master import ProcurementType
from app.models.vendor_rating import MATERIAL_CHANGE_THRESHOLD, RatingHistory, VendorRating
from app.schemas.override import OverrideDecision
from app.schemas.rating import RatingHistoryOut, RatingManualUpdate, RatingOut, RatingOverrideCreate
from app.services.audit import record
from app.security import get_current_user, require_role
from app.services import overrides
from app.services.ratings import get_or_create_rating

router = APIRouter(prefix="/api/v1/ratings", tags=["ratings"])

MANUAL_FIELDS = ("on_time_pct", "quality_pct", "compliance_pct", "responsiveness")


@router.get("", response_model=list[RatingOut])
def list_ratings(
    procurement_type: ProcurementType | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    """Every stored rating row (one per vendor per procurement type), for
    dashboards/matrices -- vendors never rated in a type simply have no row
    (they resolve to the provisional default, see services/ratings.py)."""

    query = db.query(VendorRating)
    if procurement_type is not None:
        query = query.filter(VendorRating.procurement_type == procurement_type)
    return query.all()


@router.get("/{vendor_id}", response_model=RatingOut)
def get_rating(
    vendor_id: int,
    procurement_type: ProcurementType,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    return get_or_create_rating(vendor_id, procurement_type, db)


@router.get("/{vendor_id}/history", response_model=list[RatingHistoryOut])
def get_rating_history(
    vendor_id: int,
    procurement_type: ProcurementType,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    rating = get_or_create_rating(vendor_id, procurement_type, db)
    return sorted(rating.history, key=lambda h: h.entered_at)


@router.patch("/{vendor_id}", response_model=RatingOut)
def update_rating(
    vendor_id: int,
    payload: RatingManualUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN, Role.CATEGORY_MANAGER)),
):
    """Spec §5.3.1 — routine manual entry of the four non-computed
    parameters by the Procurement Admin. `price_competitiveness` is
    deliberately not settable here: overriding it is a governed override
    (spec point 4), which routes through the override/approval engine
    (Phase 7, not built yet) rather than this ordinary data-entry endpoint."""

    rating = get_or_create_rating(vendor_id, payload.procurement_type, db)

    changes = {f: getattr(payload, f) for f in MANUAL_FIELDS if getattr(payload, f) is not None}
    if not changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No manual rating fields were provided")

    before, after = {}, {}
    for field, new_value in changes.items():
        old_value = getattr(rating, field)
        before[field], after[field] = old_value, new_value
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
    old_overall = rating.overall_score
    rating.recompute_overall()
    record(
        db, "rating.manual_entry", "rating", rating.id, actor=user,
        entity_label=f"{rating.vendor.legal_name} — {rating.procurement_type.value}",
        before={**before, "overall_score": old_overall}, after={**after, "overall_score": rating.overall_score},
        reason=payload.comment.strip() if payload.comment else None, meta={"vendor_id": rating.vendor_id},
    )
    db.commit()
    db.refresh(rating)
    return rating


def _pending_price_override(db: Session, rating_id: int) -> OverrideRequest | None:
    return (
        db.query(OverrideRequest)
        .filter(
            OverrideRequest.override_type == OverrideType.PRICE_COMPETITIVENESS_OVERRIDE,
            OverrideRequest.entity_type == "vendor_rating",
            OverrideRequest.entity_id == rating_id,
            OverrideRequest.status.in_([OverrideStatus.PENDING_APPROVAL, OverrideStatus.ESCALATED]),
        )
        .order_by(OverrideRequest.created_at.desc())
        .first()
    )


def _get_price_override(db: Session, override_id: int) -> OverrideRequest:
    override = overrides.get_override(db, override_id)
    if override.override_type != OverrideType.PRICE_COMPETITIVENESS_OVERRIDE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a price competitiveness override")
    return override


@router.post("/{vendor_id}/price-competitiveness-override", status_code=201)
def request_price_override(
    vendor_id: int,
    payload: RatingOverrideCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN, Role.CATEGORY_MANAGER)),
):
    """Spec §5.3.1 point 4 / §12.3: overriding the system-computed score is a
    governed override -- unlike update_rating() above, this never touches the
    rating directly; it only takes effect once approved (see
    approve_price_override), matching CLAUDE.md's "overrides don't touch the
    underlying record until Approved"."""

    if not 0 <= payload.new_score <= 100:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Score must be 0 to 100")
    rating = get_or_create_rating(vendor_id, payload.procurement_type, db)
    if _pending_price_override(db, rating.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A price competitiveness override is already pending approval for this vendor/type")
    override = overrides.create_override(
        db, override_type=OverrideType.PRICE_COMPETITIVENESS_OVERRIDE, initiator=user, entity_type="vendor_rating", entity_id=rating.id,
        entity_label=f"{rating.vendor.legal_name} — {rating.procurement_type.value}", reason_code=payload.reason_code, justification=payload.justification,
        proposed_change={"before": rating.price_competitiveness, "after": payload.new_score},
        trigger_value=abs(payload.new_score - rating.price_competitiveness),
    )
    db.commit()
    db.refresh(override)
    return {"override_id": override.id, "status": override.status, "required_approver_role": override.required_approver_role}


@router.post("/price-competitiveness-overrides/{override_id}/approve", response_model=RatingOut)
def approve_price_override(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_price_override(db, override_id)
    overrides.approve_override(db, override, user, payload.reason)

    rating = db.get(VendorRating, override.entity_id)
    old_value, new_value = rating.price_competitiveness, override.proposed_change["after"]
    rating.price_competitiveness = new_value
    old_overall = rating.overall_score
    rating.recompute_overall()
    db.add(
        RatingHistory(
            rating_id=rating.id, field="price_competitiveness", old_value=old_value, new_value=new_value,
            comment=override.justification, entered_by_id=user.id,
        )
    )
    record(
        db, "rating.override_applied", "rating", rating.id, actor=user, entity_label=f"{rating.vendor.legal_name} — {rating.procurement_type.value}",
        before={"price_competitiveness": old_value, "overall_score": old_overall},
        after={"price_competitiveness": new_value, "overall_score": rating.overall_score},
        reason=override.justification, meta={"vendor_id": rating.vendor_id, "override_id": override.id},
    )
    db.commit()
    db.refresh(rating)
    return rating


@router.post("/price-competitiveness-overrides/{override_id}/reject")
def reject_price_override(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_price_override(db, override_id)
    overrides.reject_override(db, override, user, payload.reason or "")
    db.commit()
    return {"override_id": override.id, "status": override.status}
