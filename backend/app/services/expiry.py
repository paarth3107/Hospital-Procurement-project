"""Statutory-document expiry (spec 3.5): flag documents that are expiring or
expired, auto-suspend a vendor with an expired document, and lift that
suspension when a renewed document has been verified.

A vendor is only ever auto-reinstated from a suspension THIS module caused
(its history reason starts with AUTO_SUSPEND_PREFIX); a manual suspension is
never lifted automatically."""

from datetime import date

from sqlalchemy.orm import Session

from app.models.vendor import (
    DOC_TYPE_LABELS,
    DocumentStatus,
    Vendor,
    VendorDocument,
    VendorStatus,
    VendorStatusHistory,
)
from app.services.vendor_status import set_status

AUTO_SUSPEND_PREFIX = "Auto-suspended: "


def _label(doc: VendorDocument) -> str:
    return doc.custom_label if doc.doc_type.value == "other" else DOC_TYPE_LABELS.get(doc.doc_type.value, doc.doc_type.value)


def expired_documents(db: Session, vendor_id: int) -> list[VendorDocument]:
    """Documents past their valid-till date. A rejected document is ignored
    (it isn't relied on for anything)."""

    return (
        db.query(VendorDocument)
        .filter(
            VendorDocument.vendor_id == vendor_id,
            VendorDocument.valid_till.isnot(None),
            VendorDocument.valid_till < date.today(),
            VendorDocument.status != DocumentStatus.REJECTED,
        )
        .all()
    )


def sweep_vendor(db: Session, vendor: Vendor) -> bool:
    """Suspends an Active vendor that has an expired document. True if changed."""

    if vendor.status != VendorStatus.ACTIVE:
        return False
    expired = expired_documents(db, vendor.id)
    if not expired:
        return False
    first = min(expired, key=lambda d: d.valid_till)
    set_status(db, vendor, VendorStatus.SUSPENDED, None, f"{AUTO_SUSPEND_PREFIX}{_label(first)} expired on {first.valid_till.isoformat()}")
    return True


def sweep_all(db: Session) -> int:
    changed = 0
    for vendor in db.query(Vendor).filter(Vendor.status == VendorStatus.ACTIVE).all():
        if sweep_vendor(db, vendor):
            changed += 1
    if changed:
        db.commit()
    return changed


def reinstate_if_cleared(db: Session, vendor: Vendor, actor_id: int | None) -> bool:
    """After a renewed document is verified: lift an expiry auto-suspension
    once no expired document remains."""

    if vendor.status != VendorStatus.SUSPENDED or expired_documents(db, vendor.id):
        return False
    last_suspend = (
        db.query(VendorStatusHistory)
        .filter(VendorStatusHistory.vendor_id == vendor.id, VendorStatusHistory.to_status == VendorStatus.SUSPENDED)
        .order_by(VendorStatusHistory.at.desc())
        .first()
    )
    if last_suspend is None or not (last_suspend.reason or "").startswith(AUTO_SUSPEND_PREFIX):
        return False
    set_status(db, vendor, VendorStatus.ACTIVE, actor_id, "Auto-reinstated: renewed document verified")
    return True
