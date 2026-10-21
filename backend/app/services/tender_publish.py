from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.product_master import ProductMaster
from app.models.tender import Tender, TenderStatus
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.services.audit import record
from app.services.notifier import notify_vendor


def notify_invited_vendors(db: Session, tender: Tender) -> None:
    """Real gap, found 2026-10-21: spec §7.4/§13.2 says a tender publish must
    notify (portal + email) every vendor on the resolved invite list --
    approve_tender() and the scheduled-publish sweep below both flipped
    status to Published without ever calling notify_vendor(), so a vendor's
    only way to learn of a new invite was to keep checking the portal
    themselves. One notification per invited vendor, naming every published
    line they're invited to on this tender. Batched (same reasoning as
    awards.py's regret/award loop) -- two queries for the whole tender, not
    one per invite row."""

    rows = (
        db.query(TenderInvite.vendor_id, TenderLineItem.product_master_id)
        .join(TenderLineItem, TenderInvite.tender_line_item_id == TenderLineItem.id)
        .filter(TenderLineItem.tender_id == tender.id, TenderLineItem.published.is_(True))
        .all()
    )
    if not rows:
        return
    product_ids = {pid for _, pid in rows}
    names = {p.id: p.name for p in db.query(ProductMaster).filter(ProductMaster.id.in_(product_ids)).all()}
    by_vendor: dict[int, list[str]] = {}
    for vendor_id, pid in rows:
        by_vendor.setdefault(vendor_id, []).append(names.get(pid, "a line item"))
    for vendor_id, lines in by_vendor.items():
        notify_vendor(
            db, vendor_id, "tender_invited", f"New tender: {tender.title}",
            f"You've been invited to bid on tender #{tender.id} ({tender.title}) for: {', '.join(lines)}. "
            f"Bids close {tender.bid_due_date.isoformat() if tender.bid_due_date else 'soon'}.",
            tender.id, {"lines": lines},
        )


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
        notify_invited_vendors(db, t)
    if due:
        db.commit()
    return len(due)
