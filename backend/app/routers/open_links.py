from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.open_link import OpenLinkOut
from app.services.open_links import facility_name, link_state, tender_for_token

router = APIRouter(prefix="/api/v1/open-links", tags=["open-links"])


@router.get("/{token}", response_model=OpenLinkOut)
def open_link_summary(token: str, db: Session = Depends(get_db)):
    """Public, because the registration screen needs it before a vendor has an
    account. Shows only the tender's identifying details, never lines, prices or
    the other vendors."""

    tender = tender_for_token(token, db)
    if tender is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This tender link is no longer valid")
    return OpenLinkOut(
        title=tender.title,
        facility_name=facility_name(tender, db),
        department=tender.department,
        bid_due_date=tender.bid_due_date,
        state=link_state(tender),
    )
