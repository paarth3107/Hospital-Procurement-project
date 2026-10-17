from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.tender import Tender, TenderStatus
from app.services.audit import record


def sweep_scheduled_publishes(db: Session) -> int:
    """Runs lazily (tender list/detail reads, the dashboard, the vendor
    portal's tender list) and from a periodic loop (main.py), same pattern
    as app/services/awards.py's sweep_no_bid_lines. Flips a Scheduled
    tender to Published once its publish_date has arrived -- approval
    already resolved and persisted invites and decided which lines have
    them (see tenders.py's approve_tender), so this is only a status flip,
    not a re-resolution."""

    now = datetime.now(timezone.utc)
    due = (
        db.query(Tender)
        .filter(Tender.status == TenderStatus.SCHEDULED, Tender.publish_date.isnot(None), Tender.publish_date <= now)
        .all()
    )
    for t in due:
        t.status = TenderStatus.PUBLISHED
        t.published_at = now
        record(
            db, "tender.published", "tender", t.id, actor=None, entity_label=f"#{t.id} {t.title}", facility_id=t.facility_id,
            before={"status": TenderStatus.SCHEDULED}, after={"status": TenderStatus.PUBLISHED},
            reason="Scheduled publish date reached.",
        )
    if due:
        db.commit()
    return len(due)
