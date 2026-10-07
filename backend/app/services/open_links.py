import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.facility import Facility
from app.models.tender import Tender, TenderStatus
from app.models.tender_invite import TenderInvite
from app.models.vendor import Vendor
from app.services.ratings import rating_score


def new_token() -> str:
    return secrets.token_urlsafe(24)


def link_state(tender: Tender) -> str:
    """A link works from creation, but a tender is only biddable once published
    and before its deadline. Until then the vendor still registers and sees the
    tender listed as not yet published."""

    if tender.status != TenderStatus.PUBLISHED:
        return "unpublished"
    if tender.bid_due_date is None or datetime.now(timezone.utc) > tender.bid_due_date:
        return "closed"
    return "open"


def tender_for_token(token: str, db: Session) -> Tender | None:
    return db.query(Tender).filter(Tender.open_link_token == token, Tender.open_tender.is_(True)).first()


def require_open_link_tender(token: str | None, db: Session) -> Tender | None:
    """Registration through a link: no token means an ordinary registration. A
    token must match a live Open Tender, and its bidding must not have closed."""

    if not token:
        return None
    tender = tender_for_token(token, db)
    if tender is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This tender link is no longer valid")
    if link_state(tender) == "closed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bidding for this tender has closed")
    return tender


def facility_name(tender: Tender, db: Session) -> str | None:
    if tender.facility_id is None:
        return None
    facility = db.get(Facility, tender.facility_id)
    return facility.name if facility else None


def invite_newly_active_vendor(vendor: Vendor, db: Session) -> None:
    """On approval: a vendor who registered through a tender's link is invited to
    it straight away, provided bidding is still open. Lines are published so the
    vendor can bid on them, as publish would have done."""

    if vendor.registered_via_tender_id is None:
        return
    tender = db.get(Tender, vendor.registered_via_tender_id)
    if tender is None or not tender.open_tender or link_state(tender) != "open":
        return
    for line in tender.line_items:
        if not any(invite.vendor_id == vendor.id for invite in line.invites):
            db.add(
                TenderInvite(
                    tender_line_item_id=line.id,
                    vendor_id=vendor.id,
                    source="open",
                    rating_at_resolution=rating_score(vendor.id, line.procurement_type, db),
                )
            )
        line.published = True
    db.flush()
