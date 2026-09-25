from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.award import Notification
from app.models.vendor import Vendor
from app.security import get_current_vendor

router = APIRouter(prefix="/api/v1/vendor-portal/notifications", tags=["vendor-notifications"])


class NotificationOut(BaseModel):
    id: int
    kind: str
    title: str
    body: str
    tender_id: int | None
    created_at: datetime
    read: bool


def _out(n: Notification) -> NotificationOut:
    return NotificationOut(id=n.id, kind=n.kind, title=n.title, body=n.body, tender_id=n.tender_id, created_at=n.created_at, read=n.read_at is not None)


@router.get("", response_model=list[NotificationOut])
def my_notifications(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    return [_out(n) for n in db.query(Notification).filter(Notification.vendor_id == vendor.id).order_by(Notification.id.desc()).all()]


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if not n or n.vendor_id != vendor.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        db.commit()
    return _out(n)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(vendor: Vendor = Depends(get_current_vendor), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    for n in db.query(Notification).filter(Notification.vendor_id == vendor.id, Notification.read_at.is_(None)).all():
        n.read_at = now
    db.commit()
