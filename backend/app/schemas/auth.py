from pydantic import BaseModel, field_validator

from app.models.user_account import Role
from app.schemas.password import check_password_strength


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CurrentUser(BaseModel):
    id: int
    email: str
    full_name: str
    role: Role
    approval_tier: int | None  # Approving Authority only -- which tier this login can decide at
    facility_id: int | None

    model_config = {"from_attributes": True}


class ForgotPasswordRequest(BaseModel):
    """Shared by both vendor and staff self-service "forgot password"
    (routers/vendor_auth.py and routers/auth.py) -- the request shape is
    identical for either actor type, only which table/token "typ" the
    endpoint uses differs. Plain `str`, not `EmailStr`: this is only ever
    used as a lookup key (an unmatched value just means the 204 response
    sends no email, same as any other non-match), and `EmailStr`'s
    special-use-domain rejection would break it for every staff seed/demo
    account (`@medsource.local`) and for login itself, which has never
    format-checked this field either (OAuth2PasswordRequestForm's
    `username`)."""

    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    _pw = field_validator("new_password")(check_password_strength)
