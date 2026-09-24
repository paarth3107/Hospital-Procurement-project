from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user_account import Role, UserAccount
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_mapping import MappingState, VendorMapping, VendorMappingHistory
from app.schemas.mapping import MappingCreate, MappingDecisionReason, MappingHistoryOut, MappingOut
from app.security import require_role
from app.services.mappings import (
    after_item_reinstated,
    after_item_suspended,
    check_rating_gate,
    close_covered_item_requests,
    create_pending_mapping,
    log_transition,
)

router = APIRouter(prefix="/api/v1/mappings", tags=["mappings"])

# Spec §4.3 point 2: "Category Manager reviews and approves or rejects" —
# Procurement Admin included as the same admin fallback used for vendor
# approval (CLAUDE.md role list treats the two as jointly responsible for
# Module 2 review).
MAPPING_REVIEWERS = (Role.CATEGORY_MANAGER, Role.PROCUREMENT_ADMIN, Role.SYSTEM_ADMIN)


_log_transition = log_transition


@router.post("", response_model=MappingOut, status_code=status.HTTP_201_CREATED)
def request_mapping(
    payload: MappingCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    """Staff-side creation (the Vendor Mapping matrix). Vendors request their
    own mappings through POST /vendor-portal/mappings instead -- this route
    used to be unauthenticated and trusted a vendor_id in the body. Item and
    category mappings are separate rows (spec 4.3); either way only an
    Active vendor qualifies (CLAUDE.md PROJECT OVERRIDE)."""

    vendor = db.get(Vendor, payload.vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    return create_pending_mapping(db, vendor, payload.product_master_id, payload.category_id)


@router.get("", response_model=list[MappingOut])
def list_mappings(
    vendor_id: int | None = None,
    product_master_id: int | None = None,
    category_id: int | None = None,
    scope: str | None = None,
    state: MappingState | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    query = db.query(VendorMapping)
    if vendor_id is not None:
        query = query.filter(VendorMapping.vendor_id == vendor_id)
    if product_master_id is not None:
        query = query.filter(VendorMapping.product_master_id == product_master_id)
    if category_id is not None:
        query = query.filter(VendorMapping.category_id == category_id)
    if scope == "item":
        query = query.filter(VendorMapping.product_master_id.isnot(None))
    elif scope == "category":
        query = query.filter(VendorMapping.category_id.isnot(None))
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
    check_rating_gate(mapping, db)
    _log_transition(db, mapping, MappingState.APPROVED, actor_id=user.id, reason=None)
    mapping.decided_by_id = user.id
    mapping.decided_at = datetime.now(timezone.utc)
    close_covered_item_requests(db, mapping, user.id)
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
    if mapping.product_master_id is not None:
        after_item_suspended(db, mapping, user.id)
    db.commit()
    db.refresh(mapping)
    return mapping


@router.post("/{mapping_id}/reinstate", response_model=MappingOut)
def reinstate_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*MAPPING_REVIEWERS)),
):
    """Reverses a suspension back to Approved -- the mirror of suspend, and
    the only way out of Suspended (a Rejected mapping stays terminal; a
    vendor would need a fresh request for that catalog entry instead)."""

    mapping = db.get(VendorMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    if mapping.state != MappingState.SUSPENDED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Mapping is in state '{mapping.state.value}' and cannot be reinstated from here",
        )
    _log_transition(db, mapping, MappingState.APPROVED, actor_id=user.id, reason=None)
    mapping.decided_by_id = user.id
    mapping.decided_at = datetime.now(timezone.utc)
    if mapping.product_master_id is not None:
        after_item_reinstated(db, mapping, user.id)
    db.commit()
    db.refresh(mapping)
    return mapping
