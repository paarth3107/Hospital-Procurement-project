from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.guest_invite_link import GuestInviteLinkOut
from app.services.guest_invite_links import facility_name, link_state, tender_for_token

router = APIRouter(prefix="/api/v1/guest-invite-links", tags=["guest-invite-links"])


@router.get("/{token}", response_model=GuestInviteLinkOut)
def guest_invite_link_summary(token: str, db: Session = Depends(get_db)):
    """Public, because the registration screen needs it before a vendor has an
    account. Shows only the tender's identifying details, never lines, prices or
    the other vendors."""

    tender = tender_for_token(token, db)
    if tender is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This tender link is no longer valid")
    return GuestInviteLinkOut(
        title=tender.title,
        facility_name=facility_name(tender, db),
        department=tender.department,
        bid_due_date=tender.bid_due_date,
        state=link_state(tender),
    )
