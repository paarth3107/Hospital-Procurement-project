"""Vendor Mapping rules shared by the staff router and the vendor portal.

Two kinds of mapping row exist (spec 4.3), each decided separately:
  - item-level:     vendor <-> one catalog entry
  - category-level: vendor <-> a whole category
Approving a category does NOT approve the items inside it as mappings, but
eligibility (services/eligibility.py) treats an approved category mapping as
covering its items unless an item-level mapping says otherwise.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.product_master import ProcurementType, ProductCategory, ProductMaster
from app.models.vendor import Vendor, VendorStatus
from app.models.vendor_mapping import MappingState, VendorMapping, VendorMappingHistory
from app.services.ratings import rating_score


def create_pending_mapping(
    db: Session, vendor: Vendor, product_master_id: int | None, category_id: int | None
) -> VendorMapping:
    """Creates a Pending mapping request for exactly one of item / category."""

    if (product_master_id is None) == (category_id is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of product_master_id (item mapping) or category_id (category mapping)",
        )
    # CLAUDE.md PROJECT OVERRIDE: only an Active, approved vendor may request a mapping.
    if vendor.status != VendorStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an Active, approved vendor may request a catalog mapping",
        )

    if product_master_id is not None:
        target = db.get(ProductMaster, product_master_id)
        if not target or not target.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
        existing = (
            db.query(VendorMapping)
            .filter(VendorMapping.vendor_id == vendor.id, VendorMapping.product_master_id == product_master_id)
            .first()
        )
    else:
        target = db.get(ProductCategory, category_id)
        if not target or not target.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
        existing = (
            db.query(VendorMapping)
            .filter(VendorMapping.vendor_id == vendor.id, VendorMapping.category_id == category_id)
            .first()
        )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A mapping between this vendor and this {'item' if product_master_id else 'category'} already exists "
            f"(state: {existing.state.value})",
        )

    mapping = VendorMapping(vendor_id=vendor.id, product_master_id=product_master_id, category_id=category_id)
    db.add(mapping)
    db.flush()
    db.add(VendorMappingHistory(mapping_id=mapping.id, from_state=None, to_state=MappingState.PENDING))
    db.commit()
    db.refresh(mapping)
    return mapping


def _rating_requirement(mapping: VendorMapping) -> tuple[float | None, ProcurementType]:
    """(minimum rating required, procurement type it's measured in). An item
    can set its own minimum, else it inherits its category's."""

    if mapping.product is not None:
        product = mapping.product
        minimum = product.min_mapping_rating
        if minimum is None:
            minimum = product.category_ref.min_mapping_rating
        return minimum, product.procurement_type
    return mapping.category.min_mapping_rating, mapping.category.procurement_type


def check_rating_gate(mapping: VendorMapping, db: Session) -> None:
    """Spec 4.4 point 2: approving a mapping to a restricted/critical entry
    requires a minimum vendor rating in that entry's procurement type."""

    minimum, ptype = _rating_requirement(mapping)
    if minimum is None:
        return
    score = rating_score(mapping.vendor_id, ptype, db)
    if score < minimum:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This mapping requires a minimum {ptype.value} rating of {minimum:g}; "
            f"the vendor's current {ptype.value} rating is {score:.1f}",
        )


def meets_rating_gate(mapping: VendorMapping, db: Session) -> bool:
    minimum, ptype = _rating_requirement(mapping)
    return minimum is None or rating_score(mapping.vendor_id, ptype, db) >= minimum


AUTO_APPROVE_REASON = "Covered by the vendor's approved category mapping"


def close_covered_item_requests(db: Session, category_mapping: VendorMapping, actor_id: int | None) -> int:
    """When a category mapping is approved, the vendor's still-pending item
    requests under that category are redundant (the category already makes
    them eligible), so approve them in the same step -- unless the item has
    its own minimum rating the vendor doesn't meet, in which case it stays
    Pending for a person to decide. Returns how many were closed."""

    if category_mapping.category_id is None:
        return 0
    pending = (
        db.query(VendorMapping)
        .join(ProductMaster, VendorMapping.product_master_id == ProductMaster.id)
        .filter(
            VendorMapping.vendor_id == category_mapping.vendor_id,
            VendorMapping.state == MappingState.PENDING,
            ProductMaster.category_id == category_mapping.category_id,
        )
        .all()
    )
    closed = 0
    for m in pending:
        if not meets_rating_gate(m, db):
            continue
        log_transition(db, m, MappingState.APPROVED, actor_id, AUTO_APPROVE_REASON)
        m.decided_by_id = actor_id
        m.decided_at = category_mapping.decided_at
        closed += 1
    return closed


def log_transition(db: Session, mapping: VendorMapping, to_state: MappingState, actor_id: int | None, reason: str | None) -> None:
    """One state change, with its history row. Every transition goes through here."""

    db.add(
        VendorMappingHistory(
            mapping_id=mapping.id, from_state=mapping.state, to_state=to_state, reason=reason, actor_id=actor_id
        )
    )
    mapping.state = to_state
    mapping.version += 1


AUTO_SUSPEND_REASON = "Auto-suspended: no eligible item left in this category"
AUTO_REINSTATE_REASON = "Auto-reinstated: an item in this category is eligible again"


def _has_eligible_item(db: Session, vendor_id: int, category_id: int, category_approved: bool) -> bool:
    """Is the vendor still eligible for at least one item in the category?
    Eligible = an approved item mapping, or (no item mapping at all and the
    category mapping is approved)."""

    products = db.query(ProductMaster).filter(ProductMaster.category_id == category_id, ProductMaster.active.is_(True)).all()
    item_mappings = {
        m.product_master_id: m
        for m in db.query(VendorMapping).filter(
            VendorMapping.vendor_id == vendor_id, VendorMapping.product_master_id.in_([p.id for p in products])
        )
    }
    for p in products:
        m = item_mappings.get(p.id)
        if m is None and category_approved:
            return True
        if m is not None and m.state == MappingState.APPROVED:
            return True
    return False


def after_item_suspended(db: Session, item_mapping: VendorMapping, actor_id: int | None) -> None:
    """Suspending one item leaves the vendor's category mapping alone as long
    as another item in the category is still eligible. If it was the last
    one (e.g. the category has a single item), the whole category mapping is
    suspended too."""

    category_id = item_mapping.product.category_id
    category_mapping = (
        db.query(VendorMapping)
        .filter(VendorMapping.vendor_id == item_mapping.vendor_id, VendorMapping.category_id == category_id)
        .first()
    )
    if category_mapping is None or category_mapping.state != MappingState.APPROVED:
        return
    if not _has_eligible_item(db, item_mapping.vendor_id, category_id, category_approved=True):
        log_transition(db, category_mapping, MappingState.SUSPENDED, actor_id, AUTO_SUSPEND_REASON)


def after_item_reinstated(db: Session, item_mapping: VendorMapping, actor_id: int | None) -> None:
    """Undo an auto-suspension of the category, but only one this rule caused
    (a category a Category Manager suspended by hand stays suspended)."""

    category_mapping = (
        db.query(VendorMapping)
        .filter(VendorMapping.vendor_id == item_mapping.vendor_id, VendorMapping.category_id == item_mapping.product.category_id)
        .first()
    )
    if category_mapping is None or category_mapping.state != MappingState.SUSPENDED:
        return
    last = max(category_mapping.history, key=lambda h: h.at, default=None)
    if last is not None and last.reason == AUTO_SUSPEND_REASON:
        log_transition(db, category_mapping, MappingState.APPROVED, actor_id, AUTO_REINSTATE_REASON)
