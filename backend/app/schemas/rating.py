from datetime import datetime

from pydantic import BaseModel


class RatingOut(BaseModel):
    id: int
    vendor_id: int
    price_competitiveness: float
    on_time_pct: float | None
    quality_pct: float | None
    compliance_pct: float | None
    responsiveness: float | None
    overall_score: float
    is_provisional: bool
    last_manual_update_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RatingManualUpdate(BaseModel):
    """Spec §5.3.1 — routine manual entry of the four non-computed
    parameters, not a governed override. `comment` is optional at the schema
    level; the router enforces it being required when a value changes by
    more than MATERIAL_CHANGE_THRESHOLD (spec point 2), since that check
    needs the prior stored value, not just this payload."""

    on_time_pct: float | None = None
    quality_pct: float | None = None
    compliance_pct: float | None = None
    responsiveness: float | None = None
    comment: str | None = None


class RatingHistoryOut(BaseModel):
    id: int
    field: str
    old_value: float | None
    new_value: float
    comment: str | None
    entered_by_id: int | None
    entered_at: datetime

    model_config = {"from_attributes": True}
