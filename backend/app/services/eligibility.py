from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.tender_line_item import TenderLineItem
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_mapping import MappingState, VendorMapping
from app.services.expiry import expired_documents
from app.services.mappings import unverified_documents
from app.services.ratings import rating_score

# Spec 4.4: "an Active mapping exists for that exact item/asset/service or
# its parent category (configurable)". True = an approved category mapping
# makes the vendor a candidate for every item in that category (an item-level
# Suspended/Rejected mapping still excludes them from that one item).
CATEGORY_MAPPING_COVERS_ITEMS = True


@dataclass
class EligibleVendor:
    vendor: Vendor
    rating_score: float


def _mapped_vendor_ids(line_item: TenderLineItem, db: Session) -> set[int]:
    product = line_item.product

    item_mappings = db.query(VendorMapping).filter(VendorMapping.product_master_id == product.id).all()
    blocked = {m.vendor_id for m in item_mappings if m.state in (MappingState.SUSPENDED, MappingState.REJECTED)}
    allowed = {m.vendor_id for m in item_mappings if m.state == MappingState.APPROVED}

    if CATEGORY_MAPPING_COVERS_ITEMS:
        category_mappings = (
            db.query(VendorMapping)
            .filter(VendorMapping.category_id == product.category_id, VendorMapping.state == MappingState.APPROVED)
            .all()
        )
        # A vendor covered only through the category still has to meet the
        # item's own minimum rating (restricted items), which the category
        # approval alone doesn't guarantee. An explicit item approval already
        # went through that gate when it was decided.
        for m in category_mappings:
            if m.vendor_id in allowed:
                continue
            minimum = product.min_mapping_rating
            if minimum is not None and rating_score(m.vendor_id, product.procurement_type, db) < minimum:
                continue
            # ...and the item's own required documents (the category's were
            # checked when the category was approved).
            if unverified_documents(db, m.vendor_id, list(product.required_documents or [])):
                continue
            allowed.add(m.vendor_id)

    return allowed - blocked


def resolve_eligible_vendors(line_item: TenderLineItem, db: Session) -> list[EligibleVendor]:
    """Spec 6.5 filter chain, in order:
    1. Vendor status = Active.
    2. Vendor has an Active (Approved) mapping to this catalog entry, or to
       its category (see CATEGORY_MAPPING_COVERS_ITEMS).
    3. Vendor's rating *for this line's procurement type* >= this line's (or
       the tender's default) threshold.
    4. If max_invites is set and more vendors qualify, rank by rating desc
       and cap at max_invites.
    """

    threshold = (
        line_item.min_rating_threshold_override
        if line_item.min_rating_threshold_override is not None
        else line_item.tender.min_rating_threshold
    )

    candidates: list[EligibleVendor] = []
    for vendor_id in _mapped_vendor_ids(line_item, db):
        vendor = db.get(Vendor, vendor_id)
        if not vendor or vendor.status != VendorStatus.ACTIVE or expired_documents(db, vendor.id):
            continue
        score = rating_score(vendor.id, line_item.procurement_type, db)
        if score >= threshold:
            candidates.append(EligibleVendor(vendor=vendor, rating_score=score))

    candidates.sort(key=lambda c: c.rating_score, reverse=True)
    if line_item.tender.max_invites is not None:
        candidates = candidates[: line_item.tender.max_invites]
    return candidates
