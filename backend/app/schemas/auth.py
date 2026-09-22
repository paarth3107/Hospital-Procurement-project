from pydantic import BaseModel

from app.models.user_account import Role


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CurrentUser(BaseModel):
    id: int
    email: str
    full_name: str
    role: Role
    facility_id: int | None

    model_config = {"from_attributes": True}
