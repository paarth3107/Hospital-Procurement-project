from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.facility import Facility
from app.models.user_account import Role, UserAccount
from app.schemas.staff import PasswordReset, StaffCreate, StaffOut, StaffUpdate
from app.security import hash_password, require_role
from app.services.audit import changed, record, snapshot

STAFF_FIELDS = ("full_name", "role", "facility_id", "approval_tier", "is_active")

router = APIRouter(prefix="/api/v1/staff", tags=["staff"])

# Staff accounts are managed by the System Admin only.
require_admin = require_role(Role.SYSTEM_ADMIN)


def _get(db: Session, user_id: int) -> UserAccount:
    user = db.get(UserAccount, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff account not found")
    return user


def _check_facility(db: Session, facility_id: int | None) -> None:
    if facility_id is not None and db.get(Facility, facility_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown facility")


def _active_admin_count(db: Session) -> int:
    return db.query(UserAccount).filter(UserAccount.role == Role.SYSTEM_ADMIN, UserAccount.is_active.is_(True)).count()


@router.get("", response_model=list[StaffOut])
def list_staff(db: Session = Depends(get_db), _admin: UserAccount = Depends(require_admin)):
    return db.query(UserAccount).order_by(UserAccount.full_name).all()


@router.post("", response_model=StaffOut, status_code=status.HTTP_201_CREATED)
def create_staff(payload: StaffCreate, db: Session = Depends(get_db), admin: UserAccount = Depends(require_admin)):
    email = payload.email.lower()
    if db.query(UserAccount).filter(UserAccount.email == email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")
    _check_facility(db, payload.facility_id)
    user = UserAccount(
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        facility_id=payload.facility_id,
        approval_tier=payload.approval_tier,
    )
    db.add(user)
    db.flush()
    record(db, "staff.created", "staff", user.id, actor=admin, entity_label=f"{user.full_name} ({user.email})", after=snapshot(user, STAFF_FIELDS), facility_id=user.facility_id)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=StaffOut)
def update_staff(user_id: int, payload: StaffUpdate, db: Session = Depends(get_db), admin: UserAccount = Depends(require_admin)):
    user = _get(db, user_id)
    if user.id == admin.id and payload.role != Role.SYSTEM_ADMIN:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You can't change your own role")
    _check_facility(db, payload.facility_id)
    old = snapshot(user, STAFF_FIELDS)
    user.full_name = payload.full_name
    user.role = payload.role
    user.facility_id = payload.facility_id
    user.approval_tier = payload.approval_tier
    if _active_admin_count(db) == 0:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="At least one active System Admin is required")
    before, after = changed(old, snapshot(user, STAFF_FIELDS))
    if after:
        record(db, "staff.updated", "staff", user.id, actor=admin, entity_label=f"{user.full_name} ({user.email})", before=before, after=after, facility_id=user.facility_id)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/deactivate", response_model=StaffOut)
def deactivate_staff(user_id: int, db: Session = Depends(get_db), admin: UserAccount = Depends(require_admin)):
    user = _get(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You can't deactivate your own account")
    user.is_active = False
    if _active_admin_count(db) == 0:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="At least one active System Admin is required")
    record(db, "staff.deactivated", "staff", user.id, actor=admin, entity_label=f"{user.full_name} ({user.email})", before={"is_active": True}, after={"is_active": False}, facility_id=user.facility_id)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/reactivate", response_model=StaffOut)
def reactivate_staff(user_id: int, db: Session = Depends(get_db), admin: UserAccount = Depends(require_admin)):
    user = _get(db, user_id)
    user.is_active = True
    record(db, "staff.reactivated", "staff", user.id, actor=admin, entity_label=f"{user.full_name} ({user.email})", before={"is_active": False}, after={"is_active": True}, facility_id=user.facility_id)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(user_id: int, payload: PasswordReset, db: Session = Depends(get_db), admin: UserAccount = Depends(require_admin)):
    user = _get(db, user_id)
    user.hashed_password = hash_password(payload.password)
    record(db, "staff.password_reset", "staff", user.id, actor=admin, entity_label=f"{user.full_name} ({user.email})", facility_id=user.facility_id)
    db.commit()
