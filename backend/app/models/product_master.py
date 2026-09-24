import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base


class ProcurementType(str, enum.Enum):
    """Spec §4.2 — drives which type-specific attribute set applies (§4.2.1)
    and, later, which tender line-item form is used (Module 4A)."""

    ITEM = "item"
    ASSET = "asset"
    SERVICE = "service"


class ProductCategory(Base):
    """Spec §4.2 Category. Its own table (was a free-text string on each
    catalog entry, so "Consumables" and "consumables " counted as two
    categories). A category belongs to one Procurement Type. It can carry a
    minimum vendor rating for restricted/critical categories (spec §4.4
    point 2), which gates approval of category-level mappings."""

    __tablename__ = "product_categories"
    __table_args__ = (UniqueConstraint("name", "procurement_type", name="uq_category_name_type"),)

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    procurement_type = Column(Enum(ProcurementType), nullable=False)
    min_mapping_rating = Column(Float, nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    products = relationship("ProductMaster", back_populates="category_ref")


class ProductMaster(Base):
    __tablename__ = "product_master"

    id = Column(Integer, primary_key=True)
    code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    procurement_type = Column(Enum(ProcurementType), nullable=False)
    category_id = Column(Integer, ForeignKey("product_categories.id"), nullable=False)
    sub_category = Column(String, nullable=True)

    # Spec §4.2 core details. All optional -- whoever creates an entry picks
    # which of these apply to it (some items need a regulatory class or a
    # brand restriction, others don't).
    unit_of_measure = Column(String, nullable=True)
    regulatory_class = Column(String, nullable=True)
    approved_brands = Column(JSON, nullable=False, default=list)
    reorder_level = Column(Float, nullable=True)
    price_band_min = Column(Float, nullable=True)
    price_band_max = Column(Float, nullable=True)
    # Spec §4.4 point 2: minimum vendor rating (in this entry's procurement
    # type) required to approve a mapping to it. Overrides the category's.
    min_mapping_rating = Column(Float, nullable=True)

    # Spec §4.2.1/§4.2.2 — the additional attribute set is genuinely
    # different per procurement_type (unit of measure + shelf life for
    # Items; warranty + certifications for Assets; SOW + SLA for Services,
    # plus the software-development/licensing sub-attributes). A single
    # JSON bag, validated per-type at the Pydantic layer (schemas/product.py),
    # is simpler than three parallel tables for a field set the spec itself
    # says is illustrative and likely to be tuned per hospital.
    type_specific_attrs = Column(JSON, nullable=False, default=dict)

    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    category_ref = relationship("ProductCategory", back_populates="products")
    mappings = relationship("VendorMapping", back_populates="product")

    @property
    def category(self) -> str:
        return self.category_ref.name
