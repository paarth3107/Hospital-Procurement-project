from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user_account import Role, UserAccount
from app.models.vendor import Vendor, VendorStatus
from app.schemas.vendor import VendorCreate, VendorOut, VendorRejection
from app.security import require_role

router = APIRouter(prefix="/api/v1/vendors", tags=["vendors"])

# Spec §3.4: only these two statuses are legal starting points for an
# admin decision. An already-Active or already-Rejected vendor can't be
# re-decided through this endpoint (a status change from there is a
# different workflow, e.g. suspension — not built in this pass).
DECIDABLE_STATUSES = {VendorStatus.PENDING_VERIFICATION, VendorStatus.INFO_REQUESTED}


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
def register_vendor(payload: VendorCreate, db: Session = Depends(get_db)):
    """Spec §3.3 registration workflow. Deliberately the *only* vendor
    creation path in this system — the Open Tender public landing page and
    the "invite a prospective vendor" flow both route here too (CLAUDE.md
    PROJECT OVERRIDE: no lightweight/guest variant that skips this)."""

    existing = db.query(Vendor).filter(Vendor.gstin == payload.gstin).first()
    if existing:
        # Spec §3.5 duplicate check + §6.8.2 point 3 (Open Tender self-
        # registration matches an existing profile instead of duplicating).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A vendor with this GSTIN is already registered (status: {existing.status.value})",
        )

    vendor = Vendor(
        legal_name=payload.legal_name,
        gstin=payload.gstin,
        pan=payload.pan,
        contact_person=payload.contact_person,
        email=payload.email,
        phone=payload.phone,
        category_declaration=payload.category_declaration,
        status=VendorStatus.PENDING_VERIFICATION,
    )
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.get("", response_model=list[VendorOut])
def list_vendors(
    status_filter: VendorStatus | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN, Role.SYSTEM_ADMIN)),
):
    query = db.query(Vendor)
    if status_filter is not None:
        query = query.filter(Vendor.status == status_filter)
    return query.order_by(Vendor.created_at.desc()).all()


@router.get("/{vendor_id}", response_model=VendorOut)
def get_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN, Role.SYSTEM_ADMIN)),
):
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return vendor


def _load_decidable_vendor(vendor_id: int, db: Session) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    if vendor.status not in DECIDABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Vendor is in status '{vendor.status.value}' and cannot be decided from here",
        )
    return vendor


@router.post("/{vendor_id}/approve", response_model=VendorOut)
def approve_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN)),
):
    """Spec §3.3 point 5 / §3.3 point 6: approval activates the vendor and
    is what makes item/asset/service mapping possible next — mapping itself
    isn't built in this pass, but the state transition that unlocks it is."""

    vendor = _load_decidable_vendor(vendor_id, db)
    vendor.status = VendorStatus.ACTIVE
    vendor.decided_at = datetime.now(timezone.utc)
    vendor.decided_by_id = user.id
    vendor.rejection_reason = None
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/reject", response_model=VendorOut)
def reject_vendor(
    vendor_id: int,
    payload: VendorRejection,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN)),
):
    vendor = _load_decidable_vendor(vendor_id, db)
    vendor.status = VendorStatus.REJECTED
    vendor.rejection_reason = payload.reason
    vendor.decided_at = datetime.now(timezone.utc)
    vendor.decided_by_id = user.id
    db.commit()
    db.refresh(vendor)
    return vendor


@router.post("/{vendor_id}/request-info", response_model=VendorOut)
def request_info(
    vendor_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(Role.PROCUREMENT_ADMIN)),
):
    vendor = _load_decidable_vendor(vendor_id, db)
    vendor.status = VendorStatus.INFO_REQUESTED
    vendor.decided_at = datetime.now(timezone.utc)
    vendor.decided_by_id = user.id
    db.commit()
    db.refresh(vendor)
    return vendor
