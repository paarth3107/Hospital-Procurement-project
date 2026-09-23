from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.facility import Facility
from app.models.user_account import UserAccount
from app.schemas.facility import FacilityOut
from app.security import get_current_user

router = APIRouter(prefix="/api/v1/facilities", tags=["facilities"])


@router.get("", response_model=list[FacilityOut])
def list_facilities(db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    """Backs the Facility picker on Tender creation -- staff-only (not
    vendor-facing anywhere yet), since nothing about a facility list needs
    to be public the way the catalog does."""
    return db.query(Facility).order_by(Facility.name).all()
