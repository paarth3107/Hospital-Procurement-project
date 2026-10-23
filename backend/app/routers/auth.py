from jose import JWTError

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user_account import UserAccount
from app.schemas.auth import CurrentUser, ForgotPasswordRequest, ResetPasswordRequest, TokenResponse
from app.security import (
    create_access_token,
    create_password_reset_token,
    decode_password_reset_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.services.audit import record
from app.services.email_adapter import send_email

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

PASSWORD_RESET_LIFETIME_MINUTES = 30
STAFF_RESET_TOKEN_TYPE = "staff_reset"


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(UserAccount).filter(UserAccount.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        record(db, "auth.login_failed", "auth", user.id if user else None, actor_label=form.username, entity_label=form.username, meta={"kind": "staff", "known_account": user is not None})
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if not user.is_active:
        record(db, "auth.login_blocked", "auth", user.id, actor=user, entity_label=user.email, reason="Account is deactivated", meta={"kind": "staff"})
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    record(db, "auth.login", "auth", user.id, actor=user, entity_label=user.email, meta={"kind": "staff"}, facility_id=user.facility_id)
    db.commit()
    return TokenResponse(access_token=create_access_token(subject=user.email))


@router.get("/me", response_model=CurrentUser)
def me(user: UserAccount = Depends(get_current_user)):
    return user


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def staff_forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Staff counterpart of vendor_auth.py's vendor_forgot_password -- same
    reasoning throughout, down to the always-204 (no account-enumeration
    leak) and the "typ": "staff_reset" JWT keeping this from ever being
    usable as, or replayable from, the vendor side's own reset token."""

    email = payload.email.strip()
    user = db.query(UserAccount).filter(UserAccount.email == email).first()
    if user is not None:
        token = create_password_reset_token(user.email, PASSWORD_RESET_LIFETIME_MINUTES, token_type=STAFF_RESET_TOKEN_TYPE)
        user.password_reset_token = token
        record(db, "auth.password_reset_requested", "staff", user.id, actor=user, entity_label=user.email, meta={"kind": "staff"})
        db.commit()
        link = f"{settings.frontend_base_url}/#/staff-reset-password/{token}"
        send_email(
            user.email, "Reset your password - MedSource",
            f"We received a request to reset your MedSource staff account password. "
            f"Use the link below to set a new one -- it expires in {PASSWORD_RESET_LIFETIME_MINUTES} minutes:\n\n{link}\n\n"
            "If you didn't request this, you can ignore this email; your password won't change.",
        )


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def staff_reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired. Request a new one.")
    try:
        email = decode_password_reset_token(payload.token, token_type=STAFF_RESET_TOKEN_TYPE)
    except JWTError:
        raise invalid
    user = db.query(UserAccount).filter(UserAccount.email == email).first()
    if user is None or user.password_reset_token != payload.token:
        raise invalid
    user.hashed_password = hash_password(payload.new_password)
    user.password_reset_token = None
    record(db, "auth.password_reset_completed", "staff", user.id, actor=user, entity_label=user.email, meta={"kind": "staff"})
    db.commit()
