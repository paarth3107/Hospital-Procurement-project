import logging

from sqlalchemy.orm import Session

from app.models.award import Notification

logger = logging.getLogger(__name__)


def notify_vendor(db: Session, vendor_id: int, kind: str, title: str, body: str, tender_id: int | None = None, data: dict | None = None) -> Notification:
    """Records a message for a vendor, shown in their portal. There is no
    email/SMS gateway adapter yet (spec 13.1), so nothing is sent outside the
    portal and that is logged rather than pretended."""
    note = Notification(vendor_id=vendor_id, kind=kind, title=title, body=body, tender_id=tender_id, data=data)
    db.add(note)
    logger.info("[vendor %s] %s — portal notification only (no email/SMS adapter configured)", vendor_id, title)
    return note
