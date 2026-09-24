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
