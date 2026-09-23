from pydantic import BaseModel


class FacilityOut(BaseModel):
    id: int
    name: str
    legal_entity_code: str

    model_config = {"from_attributes": True}
