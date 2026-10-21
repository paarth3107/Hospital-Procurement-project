import logging

from sqlalchemy.orm import Session

from app.models.award import Notification
from app.models.vendor import Vendor
from app.services.email_adapter import send_email

logger = logging.getLogger(__name__)

# Phased rollout (2026-10-19, user-directed): every vendor-facing event
# already funnels through notify_vendor() below, but email should NOT go out
# for all of them just because an adapter now exists -- only the kinds
# explicitly turned on here do. "registered" (vendors.py's
# complete_vendor_registration) and "awarded" (services/awards.py) are the
# first two; "tender_invited" (tender_publish.py's notify_invited_vendors,
# added 2026-10-21 to close a real gap -- spec §7.4 requires a publish to
# notify every invited vendor, and nothing did) is the third. Body copy is a
# first draft, meant to be revised later -- add a kind here to turn email on
# for it, nothing else to wire.
EMAIL_ENABLED_KINDS = {"registered", "awarded", "tender_invited"}


def notify_vendor(db: Session, vendor_id: int, kind: str, title: str, body: str, tender_id: int | None = None, data: dict | None = None) -> Notification:
    """Records a message for a vendor, shown in their portal, and -- for the
    kinds in EMAIL_ENABLED_KINDS -- emails it too via the adapter in
    email_adapter.py. Email is best-effort on top of the portal record, which
    stays the thing of record: a failed/unconfigured send is logged, never
    raised, so it can't break whatever business action triggered this."""
    note = Notification(vendor_id=vendor_id, kind=kind, title=title, body=body, tender_id=tender_id, data=data)
    db.add(note)

    if kind in EMAIL_ENABLED_KINDS:
        vendor = db.get(Vendor, vendor_id)
        if vendor is None:
            logger.error("notify_vendor: vendor %s not found, could not email %r", vendor_id, title)
        else:
            send_email(vendor.email, title, body)
    else:
        logger.info("[vendor %s] %s — portal notification only (kind %r not in EMAIL_ENABLED_KINDS)", vendor_id, title, kind)

    return note
