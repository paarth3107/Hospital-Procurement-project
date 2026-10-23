from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user_account import UserAccount
from app.models.vendor import Vendor

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
vendor_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/vendor-auth/login")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, token_type: str = "staff") -> str:
    # "typ" keeps staff and vendor tokens from ever being interchangeable --
    # a vendor's token must never authorize a staff-only endpoint or vice
    # versa, even though both are plain bearer JWTs signed with the same key.
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire, "typ": token_type}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_password_reset_token(email: str, expires_minutes: int, token_type: str = "vendor_reset") -> str:
    """A signed, self-expiring JWT (2026-10-23, user-directed -- replaces an
    earlier opaque `secrets.token_urlsafe` reset token with the same scheme
    every other token in this app already uses; extended the same day to
    staff, `token_type="staff_reset"`). `typ` keeps this from ever being
    accepted anywhere a real login/access token is expected, or a reset
    token issued for the other actor type, and vice versa -- same reasoning
    as `create_access_token`'s own `typ`. The `exp` claim is the only expiry
    check now; the token itself is the thing that expires, not a separate DB
    column tracking it. Still stored on the row by the caller
    (Vendor.password_reset_token / UserAccount.password_reset_token) purely
    so a used/superseded token can be invalidated server-side -- a bare
    JWT's signature alone can't be revoked once issued."""

    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload = {"sub": email, "exp": expire, "typ": token_type}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_password_reset_token(token: str, token_type: str = "vendor_reset") -> str:
    """Returns the email this token was issued for. Raises `jose.JWTError`
    (covers both a bad/tampered signature and `ExpiredSignatureError` for a
    token past its `exp`) on anything invalid, including a token of the
    other actor type (e.g. a staff reset token presented to the vendor
    endpoint) -- callers turn that into whatever HTTP response fits."""

    payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    if payload.get("typ") != token_type:
        raise JWTError("Not a password-reset token of this type")
    email = payload.get("sub")
    if email is None:
        raise JWTError("Missing subject")
    return email


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> UserAccount:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        if payload.get("typ") == "vendor":
            raise credentials_exception
        email = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(UserAccount).filter(UserAccount.email == email).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def get_current_vendor(token: str = Depends(vendor_oauth2_scheme), db: Session = Depends(get_db)) -> Vendor:
    """Mirrors get_current_user for the vendor side. Subject is the vendor's
    (unique) email."""

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        if payload.get("typ") != "vendor":
            raise credentials_exception
        email = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    vendor = db.query(Vendor).filter(Vendor.email == email).first()
    if vendor is None:
        raise credentials_exception
    return vendor


def require_role(*allowed_roles):
    """Dependency factory — every state-changing endpoint that's role-gated
    uses this rather than trusting anything the client claims about who it
    is (CLAUDE.md: never rely on frontend visibility alone)."""

    def dependency(user: UserAccount = Depends(get_current_user)) -> UserAccount:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role.value}' is not permitted to perform this action",
            )
        return user

    return dependency
