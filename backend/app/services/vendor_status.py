from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.vendor import Vendor, VendorStatus, VendorStatusHistory


def set_status(db: Session, vendor: Vendor, new_status: VendorStatus, actor_id: int | None, reason: str | None) -> None:
    """The one place a vendor's status changes, so every change is logged.
    `rejection_reason` doubles as "the explanation for the vendor's current
    non-Active status" (rejected, info requested, suspended, blacklisted)."""

    db.add(VendorStatusHistory(vendor_id=vendor.id, from_status=vendor.status, to_status=new_status, reason=reason, actor_id=actor_id))
    vendor.status = new_status
    vendor.rejection_reason = reason if new_status != VendorStatus.ACTIVE else None
    vendor.decided_at = datetime.now(timezone.utc)
    vendor.decided_by_id = actor_id
