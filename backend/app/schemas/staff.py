from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator, model_validator

from app.models.user_account import Role

MIN_PASSWORD_LENGTH = 8


def _check_password(v: str) -> str:
    if len(v) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return v


class StaffOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: Role
    facility_id: int | None
    approval_tier: int | None
    is_active: bool
    created_at: datetime | None

    model_config = {"from_attributes": True}


class StaffCreate(BaseModel):
    email: EmailStr
    full_name: str
    role: Role
    facility_id: int | None = None
    approval_tier: int | None = None
    password: str

    _pw = field_validator("password")(_check_password)

    @field_validator("full_name")
    @classmethod
    def name_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Full name is required")
        return v

    @model_validator(mode="after")
    def tier_only_for_authority(self):
        if self.role == Role.APPROVING_AUTHORITY:
            if self.approval_tier is None or self.approval_tier < 1:
                raise ValueError("An Approving Authority needs an approval tier of 1 or higher")
        else:
            self.approval_tier = None
        return self


class StaffUpdate(BaseModel):
    full_name: str
    role: Role
    facility_id: int | None = None
    approval_tier: int | None = None

    @field_validator("full_name")
    @classmethod
    def name_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Full name is required")
        return v

    @model_validator(mode="after")
    def tier_only_for_authority(self):
        if self.role == Role.APPROVING_AUTHORITY:
            if self.approval_tier is None or self.approval_tier < 1:
                raise ValueError("An Approving Authority needs an approval tier of 1 or higher")
        else:
            self.approval_tier = None
        return self


class PasswordReset(BaseModel):
    password: str

    _pw = field_validator("password")(_check_password)
