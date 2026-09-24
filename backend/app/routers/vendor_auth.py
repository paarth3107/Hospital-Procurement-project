from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.vendor import Vendor
from app.schemas.auth import TokenResponse
from app.schemas.vendor import VendorOut
from app.security import create_access_token, get_current_vendor, verify_password

router = APIRouter(prefix="/api/v1/vendor-auth", tags=["vendor-auth"])


@router.post("/login", response_model=TokenResponse)
def vendor_login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """A vendor logs in with their registered email (unique per vendor).
    Sets a "typ": "vendor" token distinct from staff's, so this can never
    be used against a staff-only endpoint."""

    email = form.username.strip().lower()
    vendor = db.query(Vendor).filter(Vendor.email == email).first()
    if not vendor or not vendor.hashed_password or not verify_password(form.password, vendor.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    return TokenResponse(access_token=create_access_token(subject=vendor.email, token_type="vendor"))


@router.get("/me", response_model=VendorOut)
def vendor_me(vendor: Vendor = Depends(get_current_vendor)):
    return vendor
