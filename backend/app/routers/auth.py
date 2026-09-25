from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user_account import UserAccount
from app.schemas.auth import CurrentUser, TokenResponse
from app.security import create_access_token, get_current_user, verify_password
from app.services.audit import record

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


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
