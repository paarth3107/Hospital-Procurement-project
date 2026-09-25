from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.vendor import Vendor, VendorStatus, VendorStatusHistory
from app.services.audit import record, staff_actor


def set_status(db: Session, vendor: Vendor, new_status: VendorStatus, actor_id: int | None, reason: str | None, actor: Vendor | None = None) -> None:
    """The one place a vendor's status changes, so every change is logged.
    `rejection_reason` doubles as "the explanation for the vendor's current
    non-Active status" (rejected, info requested, suspended, blacklisted)."""

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
