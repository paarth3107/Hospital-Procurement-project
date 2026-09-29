from datetime import datetime

from pydantic import BaseModel

from app.models.bid import BidStatus
from app.models.tender import TenderStatus, TenderType


class PortalLineItemOut(BaseModel):
    line_item_id: int
    product_name: str
    qty: float
    already_bid: bool
    bid_status: BidStatus | None


class PortalTenderOut(BaseModel):
    tender_id: int
    title: str
    facility_name: str
    tender_type: TenderType
    status: TenderStatus
    bid_due_date: datetime | None
    can_bid: bool
    line_items: list[PortalLineItemOut]
