from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.vendor import Vendor, VendorStatus, VendorStatusHistory
from app.services.audit import record, staff_actor
from app.services.notifier import notify_vendor

# (title, fixed body) per target status, for the vendor-facing notification set_status
# fires below. A fixed body means that status's own `reason` text is an internal audit
# note (e.g. "Approved", "Reinstated"), not phrasing meant for the vendor to read --
# everything else uses the real `reason` (it IS the explanation: why rejected, what info
# is needed, why suspended/blacklisted).
_STATUS_MESSAGES: dict[VendorStatus, tuple[str, str | None]] = {
    VendorStatus.ACTIVE: ("Registration approved", "You're now an Active vendor and can bid on tenders you're invited to."),
    VendorStatus.REJECTED: ("Registration rejected", None),
    VendorStatus.INFO_REQUESTED: ("More information needed", None),
    VendorStatus.SUSPENDED: ("Account suspended", None),
    VendorStatus.BLACKLISTED: ("Account blacklisted", None),
}


def set_status(db: Session, vendor: Vendor, new_status: VendorStatus, actor_id: int | None, reason: str | None, actor: Vendor | None = None) -> None:
    """The one place a vendor's status changes, so every change is logged.
    `rejection_reason` doubles as "the explanation for the vendor's current
    non-Active status" (rejected, info requested, suspended, blacklisted).

    Also the one place a status-change notification is sent (2026-10-07) --
    covers every call site (staff decisions in vendors.py, the auto-suspend/
    auto-reinstate sweep in expiry.py) uniformly. Skipped when the vendor is
    its own actor (it responding to an info request moves it back to Pending
    Verification) -- it already knows what it just did."""

    old_status = vendor.status
    db.add(VendorStatusHistory(vendor_id=vendor.id, from_status=old_status, to_status=new_status, reason=reason, actor_id=actor_id))
    record(
        db, "vendor.status_changed", "vendor", vendor.id,
        actor=actor or staff_actor(db, actor_id), entity_label=vendor.legal_name,
        before={"status": old_status}, after={"status": new_status}, reason=reason,
    )
    vendor.status = new_status
    vendor.rejection_reason = reason if new_status != VendorStatus.ACTIVE else None
    vendor.decided_at = datetime.now(timezone.utc)
    vendor.decided_by_id = actor_id
    if actor is None:
        title, fixed_body = _STATUS_MESSAGES.get(new_status, (f"Status changed to {new_status.value.replace('_', ' ')}", None))
        notify_vendor(db, vendor.id, kind=f"vendor_{new_status.value}", title=title, body=fixed_body or reason or "", data={"status": new_status.value})
