from datetime import datetime

from pydantic import BaseModel


class OpenLinkOut(BaseModel):
    """What a vendor sees on the registration screen for an Open Tender link:
    just enough to know which tender they are registering for."""

    title: str
    facility_name: str | None
    department: str | None
    bid_due_date: datetime | None
    state: str  # unpublished | open | closed


class RegisteredTenderOut(OpenLinkOut):
    id: int
    tender_status: str
