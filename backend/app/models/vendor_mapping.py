import enum

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base


class MappingState(str, enum.Enum):
    """Spec §4.3. A mapping is the sole gate for a vendor being eligible to
    supply a given catalog entry — checked later during tender eligibility
    resolution (spec §6.5), which only this system doesn't build yet."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SUSPENDED = "suspended"


class VendorMapping(Base):
    __tablename__ = "vendor_mappings"
    # A mapping is EITHER item-level (product_master_id) OR category-level
    # (category_id) -- never both. Item and category mappings are separate
    # rows with separate approvals (spec §4.3: approving a category does not
    # approve every item in it).
    __table_args__ = (
        UniqueConstraint("vendor_id", "product_master_id", name="uq_vendor_product"),
        UniqueConstraint("vendor_id", "category_id", name="uq_vendor_category"),
        CheckConstraint(
            "(product_master_id IS NOT NULL AND category_id IS NULL) OR (product_master_id IS NULL AND category_id IS NOT NULL)",
            name="ck_mapping_item_xor_category",
        ),
    )

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    product_master_id = Column(Integer, ForeignKey("product_master.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("product_categories.id"), nullable=True)
    state = Column(Enum(MappingState), nullable=False, default=MappingState.PENDING)

    requested_at = Column(DateTime(timezone=True), server_default=func.now())
    decided_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, nullable=False, default=1)

    vendor = relationship("Vendor")
    product = relationship("ProductMaster", back_populates="mappings")
    category = relationship("ProductCategory")
    history = relationship("VendorMappingHistory", back_populates="mapping", cascade="all, delete-orphan")


class VendorMappingHistory(Base):
    """Spec §4.3 point 3: "removal/suspension of a mapping ... is logged
    with reason" — one row per state change, the mapping row itself never
    silently loses its prior state."""

    __tablename__ = "vendor_mapping_history"

    id = Column(Integer, primary_key=True)
    mapping_id = Column(Integer, ForeignKey("vendor_mappings.id"), nullable=False)
    from_state = Column(Enum(MappingState), nullable=True)
    to_state = Column(Enum(MappingState), nullable=False)
    reason = Column(Text, nullable=True)
    actor_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    at = Column(DateTime(timezone=True), server_default=func.now())

    mapping = relationship("VendorMapping", back_populates="history")
