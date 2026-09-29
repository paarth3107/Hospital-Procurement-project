from pydantic import BaseModel, field_validator


class FacilityCreate(BaseModel):
    name: str
    legal_entity_code: str

    @field_validator("name", "legal_entity_code")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Required")
        return v


class FacilityOut(BaseModel):
    id: int
    name: str
    legal_entity_code: str

    model_config = {"from_attributes": True}
