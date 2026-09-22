from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product_master import ProductMaster
from app.models.user_account import Role, UserAccount
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_mapping import MappingState, VendorMapping, VendorMappingHistory
from app.schemas.mapping import MappingCreate, MappingDecisionReason, MappingHistoryOut, MappingOut
from app.security import require_role

router = APIRouter(prefix="/api/v1/mappings", tags=["mappings"])

# Spec §4.3 point 2: "Category Manager reviews and approves or rejects" —
# Procurement Admin included as the same admin fallback used for vendor
# approval (CLAUDE.md role list treats the two as jointly responsible for
# Module 2 review).
MAPPING_REVIEWERS = (Role.CATEGORY_MANAGER, Role.PROCUREMENT_ADMIN, Role.SYSTEM_ADMIN)


def _log_transition(
    db: Session,
    mapping: VendorMapping,
    to_state: MappingState,
    actor_id: int | None,
    reason: str | None,
) -> None:
    db.add(
        VendorMappingHistory(
            mapping_id=mapping.id,
            from_state=mapping.state,
            to_state=to_state,
            reason=reason,
            actor_id=actor_id,
        )
    )
    mapping.state = to_state
    mapping.version += 1


@router.post("", response_model=MappingOut, status_code=status.HTTP_201_CREATED)
def request_mapping(payload: MappingCreate, db: Session = Depends(get_db)):
    """Spec §4.3 point 1: "Vendor requests mapping ... at registration or
    later." No vendor login exists yet (Phase 1 built staff auth only), so
    this is unauthenticated like vendor registration itself — but per
    CLAUDE.md PROJECT OVERRIDE, only a vendor that has already cleared
    Vendor Approval (Active) may request a mapping at all; there's no path
    for an unapproved vendor to get onto the review queue."""

    vendor = db.get(Vendor, payload.vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    if vendor.status != VendorStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an Active, approved vendor may request a catalog mapping",
        )

    product = db.get(ProductMaster, payload.product_master_id)
    if not product or not product.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")

    existing = (
        db.query(VendorMapping)
        .filter(
            VendorMapping.vendor_id == payload.vendor_id,
            VendorMapping.product_master_id == payload.product_master_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A mapping between this vendor and catalog entry already exists (state: {existing.state.value})",
        )

    mapping = VendorMapping(vendor_id=payload.vendor_id, product_master_id=payload.product_master_id)
    db.add(mapping)
    db.flush()
    db.add(VendorMappingHistory(mapping_id=mapping.id, from_state=None, to_state=MappingState.PENDING))
    db.commit()
    db.refresh(mapping)
    return mapping


@router.get("", response_model=list[MappingOut])
def list_mappings(
    vendor_id: int | None = None,
    product_master_id: int | None = None,
    state: MappingState | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    query = db.query(VendorMapping)
    if vendor_id is not None:
        query = query.filter(VendorMapping.vendor_id == vendor_id)
    if product_master_id is not None:
        query = query.filter(VendorMapping.product_master_id == product_master_id)
    if state is not None:
        query = query.filter(VendorMapping.state == state)
    return query.order_by(VendorMapping.requested_at.desc()).all()


@router.get("/{mapping_id}", response_model=MappingOut)
def get_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    mapping = db.get(VendorMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    return mapping


@router.get("/{mapping_id}/history", response_model=list[MappingHistoryOut])
def get_mapping_history(
    mapping_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    mapping = db.get(VendorMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    return sorted(mapping.history, key=lambda h: h.at)


def _load_pending_mapping(mapping_id: int, db: Session) -> VendorMapping:
    mapping = db.get(VendorMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    if mapping.state != MappingState.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Mapping is in state '{mapping.state.value}' and cannot be decided from here",
        )
    return mapping


@router.post("/{mapping_id}/approve", response_model=MappingOut)
def approve_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    mapping = _load_pending_mapping(mapping_id, db)
    _log_transition(db, mapping, MappingState.APPROVED, actor_id=user.id, reason=None)
    mapping.decided_by_id = user.id
    mapping.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(mapping)
    return mapping


@router.post("/{mapping_id}/reject", response_model=MappingOut)
def reject_mapping(
    mapping_id: int,
    payload: MappingDecisionReason,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    mapping = _load_pending_mapping(mapping_id, db)
    _log_transition(db, mapping, MappingState.REJECTED, actor_id=user.id, reason=payload.reason)
    mapping.decided_by_id = user.id
    mapping.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(mapping)
    return mapping


@router.post("/{mapping_id}/suspend", response_model=MappingOut)
def suspend_mapping(
    mapping_id: int,
    payload: MappingDecisionReason,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    """Spec §4.3 point 3 / §4.4: suspension applies to an already-approved
    mapping (e.g. after a quality issue), not a pending one."""

    mapping = db.get(VendorMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    if mapping.state != MappingState.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Mapping is in state '{mapping.state.value}' and cannot be suspended from here",
        )
    _log_transition(db, mapping, MappingState.SUSPENDED, actor_id=user.id, reason=payload.reason)
    mapping.decided_by_id = user.id
    mapping.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(mapping)
    return mapping
