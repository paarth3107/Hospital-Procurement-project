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
    """A vendor logs in with GSTIN, not email -- Vendor.email isn't unique
    on this model, GSTIN is (and is what they already typed at registration,
    same field, same format). Sets a "typ": "vendor" token distinct from
    staff's, so this can never be used against a staff-only endpoint."""

    gstin = form.username.strip().upper()
    vendor = db.query(Vendor).filter(Vendor.gstin == gstin).first()
    if not vendor or not vendor.hashed_password or not verify_password(form.password, vendor.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect GSTIN or password")
    return TokenResponse(access_token=create_access_token(subject=vendor.gstin, token_type="vendor"))


@router.get("/me", response_model=VendorOut)
def vendor_me(vendor: Vendor = Depends(get_current_vendor)):
    return vendor
