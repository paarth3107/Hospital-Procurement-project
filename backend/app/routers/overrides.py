from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.override import OverrideStatus, OverrideType
from app.models.user_account import UserAccount
from app.schemas.override import OverrideCreate, OverrideDecision, OverrideOut
from app.security import get_current_user
from app.services import overrides

router = APIRouter(prefix="/api/v1/overrides", tags=["overrides"])


@router.get("", response_model=list[OverrideOut])
def list_overrides(
    status: OverrideStatus | None = None,
    override_type: OverrideType | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    """Every override instance, across every type (spec §12.6: "the override
    audit trail is queryable independently per type"). No module surfaces
    these in its own screens yet -- see backend/README.md -- so this list is
    the only place they're visible today."""

    return overrides.list_overrides(db, status_filter=status, override_type=override_type)


@router.get("/{override_id}", response_model=OverrideOut)
def get_override(override_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    return overrides.get_override(db, override_id)


@router.post("", response_model=OverrideOut, status_code=201)
def create_override(payload: OverrideCreate, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Any authenticated staff member may request any override type -- the
    engine itself resolves who must approve it (spec §12.5), including
    whether the requester's own role clears it immediately (self-attested
    types). This is deliberately not restricted per type here: per CLAUDE.md
    ("one reusable override/approval engine... not bespoke logic per
    module"), which roles typically initiate which type is a UI/workflow
    concern for whichever module eventually wires this in, not a rule this
    generic endpoint should hardcode."""

    result = overrides.create_override(
        db,
        override_type=payload.override_type,
        initiator=user,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        entity_label=payload.entity_label,
        facility_id=payload.facility_id,
        reason_code=payload.reason_code,
        justification=payload.justification,
        proposed_change=payload.proposed_change,
        trigger_value=payload.trigger_value,
    )
    db.commit()
    db.refresh(result)
    return result


@router.post("/{override_id}/approve", response_model=OverrideOut)
def approve(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = overrides.get_override(db, override_id)
    overrides.approve_override(db, override, user, payload.reason)
    db.commit()
    db.refresh(override)
    return override


@router.post("/{override_id}/reject", response_model=OverrideOut)
def reject(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = overrides.get_override(db, override_id)
    overrides.reject_override(db, override, user, payload.reason or "")
    db.commit()
    db.refresh(override)
    return override


@router.post("/{override_id}/escalate", response_model=OverrideOut)
def escalate(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = overrides.get_override(db, override_id)
    overrides.escalate_override(db, override, user, payload.reason or "")
    db.commit()
    db.refresh(override)
    return override
