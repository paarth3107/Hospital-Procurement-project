from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.facility import Facility
from app.models.user_account import Role, UserAccount
from app.schemas.facility import FacilityCreate, FacilityOut
from app.security import get_current_user, require_role
from app.services.audit import record

router = APIRouter(prefix="/api/v1/facilities", tags=["facilities"])

# Facilities are a System Admin concern (spec §2.3: multi-facility/entity setup).
require_admin = require_role(Role.SYSTEM_ADMIN)


@router.get("", response_model=list[FacilityOut])
def list_facilities(db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    """Backs the Facility picker on Tender creation -- staff-only (not
    vendor-facing anywhere yet), since nothing about a facility list needs
    to be public the way the catalog does."""
    return db.query(Facility).order_by(Facility.name).all()


@router.post("", response_model=FacilityOut, status_code=status.HTTP_201_CREATED)
def create_facility(payload: FacilityCreate, db: Session = Depends(get_db), admin: UserAccount = Depends(require_admin)):
    if db.query(Facility).filter(Facility.legal_entity_code == payload.legal_entity_code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A facility with this legal entity code already exists")
    facility = Facility(name=payload.name, legal_entity_code=payload.legal_entity_code)
    db.add(facility)
    db.flush()
    record(db, "facility.created", "facility", facility.id, actor=admin, entity_label=facility.name, after={"name": facility.name, "legal_entity_code": facility.legal_entity_code})
    db.commit()
    db.refresh(facility)
    return facility
