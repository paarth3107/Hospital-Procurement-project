import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, Integer, JSON, String, func
from sqlalchemy.orm import relationship

from app.database import Base


class ProcurementType(str, enum.Enum):
    """Spec §4.2 — drives which type-specific attribute set applies (§4.2.1)
    and, later, which tender line-item form is used (Module 4A)."""

    ITEM = "item"
    ASSET = "asset"
    SERVICE = "service"


class ProductMaster(Base):
    __tablename__ = "product_master"

    id = Column(Integer, primary_key=True)
    code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    procurement_type = Column(Enum(ProcurementType), nullable=False)
    category = Column(String, nullable=False)
    sub_category = Column(String, nullable=True)

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

    mappings = relationship("VendorMapping", back_populates="product")
