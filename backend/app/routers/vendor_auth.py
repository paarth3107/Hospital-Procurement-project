from jose import JWTError

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.vendor import Vendor, VendorStatus
from app.schemas.auth import ForgotPasswordRequest, ResetPasswordRequest, TokenResponse
from app.schemas.vendor import VendorOut
from app.security import (
    create_access_token,
    create_password_reset_token,
    decode_password_reset_token,
    get_current_vendor,
    hash_password,
    verify_password,
)
from app.services.audit import record
from app.services.email_adapter import send_email

router = APIRouter(prefix="/api/v1/vendor-auth", tags=["vendor-auth"])

PASSWORD_RESET_LIFETIME_MINUTES = 30


@router.post("/login", response_model=TokenResponse)
def vendor_login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """A vendor logs in with their registered email (unique per vendor).
    Sets a "typ": "vendor" token distinct from staff's, so this can never
    be used against a staff-only endpoint."""

    email = form.username.strip().lower()
    vendor = db.query(Vendor).filter(Vendor.email == email).first()
    if not vendor or not vendor.hashed_password or not verify_password(form.password, vendor.hashed_password):
        record(db, "auth.login_failed", "auth", vendor.id if vendor else None, actor_label=email, entity_label=email, meta={"kind": "vendor", "known_account": vendor is not None})
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if vendor.status == VendorStatus.BLACKLISTED:
        record(db, "auth.login_blocked", "auth", vendor.id, actor=vendor, entity_label=email, reason="Vendor is blacklisted", meta={"kind": "vendor"})
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This vendor account has been barred")
    record(db, "auth.login", "auth", vendor.id, actor=vendor, entity_label=email, meta={"kind": "vendor"})
    db.commit()
    return TokenResponse(access_token=create_access_token(subject=vendor.email, token_type="vendor"))


@router.get("/me", response_model=VendorOut)
def vendor_me(vendor: Vendor = Depends(get_current_vendor)):
    # .from_vendor(), not a plain return -- VendorOut.email_verified mirrors
    # Vendor.email_verified_at (a different attribute name), so it needs the
    # explicit derivation rather than automatic from_attributes mapping.
    return VendorOut.from_vendor(vendor)


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def vendor_forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Always 204 regardless of whether the email matches a vendor --
    revealing that would let anyone probe which emails are registered.
    Only a real match actually gets a token + email; same lesson
    registration's own duplicate-check learned the hard way, applied here
    from the start instead."""

    email = payload.email.strip().lower()
    vendor = db.query(Vendor).filter(Vendor.email == email).first()
    if vendor is not None and vendor.hashed_password:
        token = create_password_reset_token(vendor.email, PASSWORD_RESET_LIFETIME_MINUTES)
        vendor.password_reset_token = token
        record(db, "auth.password_reset_requested", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name)
        db.commit()
        link = f"{settings.frontend_base_url}/#/reset-password/{token}"
        send_email(
            vendor.email, "Reset your password - MedSource",
            f"We received a request to reset your MedSource vendor account password. "
            f"Use the link below to set a new one -- it expires in {PASSWORD_RESET_LIFETIME_MINUTES} minutes:\n\n{link}\n\n"
            "If you didn't request this, you can ignore this email; your password won't change.",
        )


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def vendor_reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired. Request a new one.")
    try:
        email = decode_password_reset_token(payload.token)
    except JWTError:
        # Covers a tampered/garbage token and (via jose's own
        # ExpiredSignatureError, a JWTError subclass) one past its "exp" --
        # the JWT's own signature check does what the old expires_at column
        # comparison used to do by hand.
        raise invalid
    vendor = db.query(Vendor).filter(Vendor.email == email).first()
    # The stored value is still the one source of truth for "is this THE
    # currently live reset request" -- a valid, unexpired signature alone
    # isn't enough once it's already been used or a newer request has
    # superseded it; a bare JWT can't be revoked any other way.
    if vendor is None or vendor.password_reset_token != payload.token:
        raise invalid
    vendor.hashed_password = hash_password(payload.new_password)
    vendor.password_reset_token = None
    record(db, "auth.password_reset_completed", "vendor", vendor.id, actor=vendor, entity_label=vendor.legal_name)
    db.commit()
