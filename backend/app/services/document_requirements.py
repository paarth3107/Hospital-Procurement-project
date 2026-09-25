"""What documents a vendor still owes, item by item (user-directed rule: even
when a whole category is allotted, an item that asks for a document the vendor
hasn't provided needs it submitted by the vendor and verified by the Category
Manager before the vendor can be invited to that item).

Computed live from the catalog and the vendor's documents, independent of any
mapping row, so a requirement added to an item later shows up immediately for
a vendor who already holds the category (or the item)."""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.product_master import ProductMaster
from app.models.vendor import DocumentStatus, Vendor, VendorDocument, requirement_key, requirement_label
from app.models.vendor_mapping import MappingState, VendorMapping
from app.services.expiry import expired_documents
from app.schemas.vendor_document import ItemRequirementOut, RequiredDocumentOut
from app.services.mappings import required_document_types


@dataclass
class DocState:
    entry: str  # the catalog's required_documents entry ("gst_certificate" or "other:CE mark")
    label: str
    state: str  # missing | pending | verified | rejected | expired
    doc_id: int | None = None
    reason: str | None = None


@dataclass
class ItemRequirement:
    product: ProductMaster
    source: str  # "category" (covered by an approved category) | "item" (own item mapping)
    mapping_state: str  # approved | pending
    documents: list[DocState] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return all(d.state == "verified" for d in self.documents)

    @property
    def needs_vendor(self) -> bool:
        return any(d.state in ("missing", "rejected", "expired") for d in self.documents)

    @property
    def summary(self) -> str:
        if self.complete:
            return "verified"
        return "documents_needed" if self.needs_vendor else "awaiting_verification"


def _doc_states(db: Session, vendor_id: int, entries: list[str]) -> list[DocState]:
    docs = {d.requirement_key: d for d in db.query(VendorDocument).filter(VendorDocument.vendor_id == vendor_id).all()}
    expired = {d.requirement_key for d in expired_documents(db, vendor_id)}
    out = []
    for entry in entries:
        key = requirement_key(entry)
        doc = docs.get(key)
        if doc is None:
            state, reason = "missing", None
        elif key in expired:
            state, reason = "expired", "This document has expired; upload the renewed one"
        elif doc.status == DocumentStatus.REJECTED:
            state, reason = "rejected", doc.rejection_reason
        elif doc.status == DocumentStatus.VERIFIED:
            state, reason = "verified", None
        else:
            state, reason = "pending", None
        out.append(DocState(entry=entry, label=requirement_label(entry), state=state, doc_id=doc.id if doc else None, reason=reason))
    return out


def vendor_requirements(db: Session, vendor: Vendor) -> list[ItemRequirement]:
    """Every active item this vendor is covered for (via an approved category)
    or has asked for (an item mapping that is pending or approved), together
    with the state of each document that item requires. Items that require no
    documents are left out."""
    mappings = db.query(VendorMapping).filter(VendorMapping.vendor_id == vendor.id).all()
    item_maps = {m.product_master_id: m for m in mappings if m.product_master_id is not None}
    approved_categories = {m.category_id for m in mappings if m.category_id is not None and m.state == MappingState.APPROVED}

    products = db.query(ProductMaster).filter(ProductMaster.active.is_(True)).order_by(ProductMaster.code).all()
    result: list[ItemRequirement] = []
    for p in products:
        item_map = item_maps.get(p.id)
        if item_map is not None and item_map.state in (MappingState.REJECTED, MappingState.SUSPENDED):
            continue  # the vendor is excluded from this item anyway
        if item_map is not None:
            source, mstate = "item", item_map.state.value
        elif p.category_id in approved_categories:
            source, mstate = "category", "approved"
        else:
            continue
        entries = required_document_types(p, p.category_ref)
        if not entries:
            continue
        result.append(ItemRequirement(product=p, source=source, mapping_state=mstate, documents=_doc_states(db, vendor.id, entries)))
    return result


def action_needed_count(requirements: list[ItemRequirement]) -> int:
    return sum(1 for r in requirements if r.needs_vendor)


def to_out(requirements: list[ItemRequirement]) -> list[ItemRequirementOut]:
    """Unresolved items first (documents needed, then awaiting verification), verified last."""
    order = {"documents_needed": 0, "awaiting_verification": 1, "verified": 2}
    out = [
        ItemRequirementOut(
            product_id=r.product.id, product_code=r.product.code, product_name=r.product.name, category=r.product.category_ref.name,
            source=r.source, mapping_state=r.mapping_state, summary=r.summary,
            documents=[RequiredDocumentOut(entry=d.entry, label=d.label, state=d.state, doc_id=d.doc_id, reason=d.reason) for d in r.documents],
        )
        for r in requirements
    ]
    out.sort(key=lambda x: (order[x.summary], x.product_code))
    return out
