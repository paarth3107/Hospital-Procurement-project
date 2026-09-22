from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.tender_line_item import TenderLineItem
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_mapping import MappingState, VendorMapping
from app.models.vendor_rating import VendorRating

# The default a freshly-created VendorRating resolves to (only
# price_competitiveness=50.0 set, nothing else) — see
# VendorRating.recompute_overall(). Mirrored here so eligibility resolution
# doesn't have to persist a rating row just to read this vendor's score.
DEFAULT_RATING_SCORE = 50.0


@dataclass
class EligibleVendor:
    vendor: Vendor
    rating_score: float


def resolve_eligible_vendors(line_item: TenderLineItem, db: Session) -> list[EligibleVendor]:
    """Spec §6.5 filter chain, in order:
    1. Vendor status = Active.
    2. Vendor has an Active (Approved) Vendor Mapping to this catalog entry.
    3. Vendor's rating >= this line's (or the tender's default) threshold.
    4. (Suspended/blacklisted vendors are already excluded by #1 — this
       system has no separate Suspended-but-still-Active state.)
    5. If max_invites is set and more vendors qualify, rank by rating desc
       and cap at max_invites.
    """

    threshold = (
        line_item.min_rating_threshold_override
        if line_item.min_rating_threshold_override is not None
        else line_item.tender.min_rating_threshold
    )

    mappings = (
        db.query(VendorMapping)
        .filter(
            VendorMapping.product_master_id == line_item.product_master_id,
            VendorMapping.state == MappingState.APPROVED,
        )
        .all()
    )

    candidates: list[EligibleVendor] = []
    for mapping in mappings:
        vendor = db.get(Vendor, mapping.vendor_id)
        if not vendor or vendor.status != VendorStatus.ACTIVE:
            continue
        rating = db.query(VendorRating).filter(VendorRating.vendor_id == vendor.id).first()
        score = rating.overall_score if rating else DEFAULT_RATING_SCORE
        if score >= threshold:
            candidates.append(EligibleVendor(vendor=vendor, rating_score=score))

    candidates.sort(key=lambda c: c.rating_score, reverse=True)
    if line_item.tender.max_invites is not None:
        candidates = candidates[: line_item.tender.max_invites]
    return candidates
