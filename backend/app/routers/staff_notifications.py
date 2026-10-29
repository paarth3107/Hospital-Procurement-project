from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.staff_notification import StaffNotification
from app.models.user_account import UserAccount
from app.schemas.staff_notification import StaffNotificationOut
from app.security import get_current_user

# Mirrors vendor_notifications.py's shape/endpoints -- staff's side of the
# same idea, first used 2026-10-22 (user-directed) to tell an override's
# initiator once someone decides it (services/overrides.py writes these,
# not any per-router code).
router = APIRouter(prefix="/api/v1/staff-notifications", tags=["staff-notifications"])


def _out(n: StaffNotification) -> StaffNotificationOut:
    return StaffNotificationOut(
        id=n.id, kind=n.kind, title=n.title, body=n.body,
        entity_type=n.entity_type, entity_id=n.entity_id,
        created_at=n.created_at, read=n.read_at is not None,
    )


@router.get("", response_model=list[StaffNotificationOut])
def my_notifications(user: UserAccount = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_out(n) for n in db.query(StaffNotification).filter(StaffNotification.user_id == user.id).order_by(StaffNotification.created_at.desc(), StaffNotification.id.desc()).all()]


@router.post("/{notification_id}/read", response_model=StaffNotificationOut)
def mark_read(notification_id: int, user: UserAccount = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(StaffNotification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        db.commit()
    return _out(n)
