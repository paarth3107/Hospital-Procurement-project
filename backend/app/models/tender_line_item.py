import enum

from sqlalchemy import JSON, Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, func
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.product_master import ProcurementType


class TechnicalEvalMethod(str, enum.Enum):
    """Spec §9.2/§9.4. Fixed per line item at creation, not changeable later
    (spec §9.4: "an optional per-line-item alternative to plain L1, fixed at
    tender creation")."""

    QUALIFY_DISQUALIFY = "qualify_disqualify"
    SCORED = "scored"
    QCBS = "qcbs"


class TenderLineItem(Base):
    __tablename__ = "tender_line_items"

    id = Column(Integer, primary_key=True)
    tender_id = Column(Integer, ForeignKey("tenders.id"), nullable=False)
    product_master_id = Column(Integer, ForeignKey("product_master.id"), nullable=False)

    # Denormalized at creation time rather than always joining through
    # ProductMaster — a line item's procurement type shouldn't silently
    # change if the catalog entry is edited after the tender is drafted.
    procurement_type = Column(Enum(ProcurementType), nullable=False)

    qty = Column(Float, nullable=False)
    # Spec §6.3.1/6.3.2/6.3.3 "reference only, not shown to vendors" — used
    # for the approval-value band (app/services/approval_matrix.py) and bid
    # variance checks later (Phase 4+), never serialized to a vendor-facing
    # response.
    estimated_price = Column(Float, nullable=True)

    split_award_allowed = Column(Boolean, nullable=False, default=False)

    # Partial publishing: when a tender is approved, only lines that resolved to
    # at least one eligible vendor are published; a line with none is held back
    # (published=False) and can be published later once vendors qualify.
    published = Column(Boolean, nullable=False, default=False)
    min_rating_threshold_override = Column(Float, nullable=True)

    technical_eval_method = Column(Enum(TechnicalEvalMethod), nullable=False, default=TechnicalEvalMethod.QUALIFY_DISQUALIFY)
    technical_weight = Column(Float, nullable=True)  # QCBS only (spec §9.4)
    price_weight = Column(Float, nullable=True)  # QCBS only

    # Spec §6.3.1-6.3.3's large type-specific field sets (SOW, warranty,
    # SLA parameters, delivery location, etc.) — a JSON bag here for the
    # same reason as ProductMaster.type_specific_attrs: the field set is
    # explicitly illustrative and type-dependent, not a fixed schema.
    line_details = Column(JSON, nullable=False, default=dict)

    # Spec 9.2.3 / 9.6: prices open only after technical qualification is recorded
    # for the line. Set when an evaluator closes the line's technical evaluation.
    technical_closed_at = Column(DateTime(timezone=True), nullable=True)
    technical_closed_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tender = relationship("Tender", back_populates="line_items")
    product = relationship("ProductMaster")
    invites = relationship("TenderInvite", back_populates="line_item", cascade="all, delete-orphan")
