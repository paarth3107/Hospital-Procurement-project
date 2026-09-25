import enum

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class TenderType(str, enum.Enum):
    """Spec §6.2. Open Tender (§6.8 — public self-registration, bypasses
    eligibility filtering) is intentionally not included yet: it needs its
    own public-landing/self-registration path, deferred until that's built
    rather than adding a type that silently does nothing."""

    RFQ = "rfq"
    RFP = "rfp"
    RATE_CONTRACT = "rate_contract"


class TenderStatus(str, enum.Enum):
    """Spec §7.3/§7.4 state machine. Only Draft/Pending/Published/Withdrawn
    are reachable in this phase — Bid Window Closed onward belongs to
    Bidding/Evaluation/Award (Phases 4-6, IMPLEMENTATION-SPEC.md §11)."""

    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    PUBLISHED = "published"
    WITHDRAWN = "withdrawn"
    NO_AWARD = "no_award"  # every line was left out of the award: closed with nothing awarded, no PO files
    AWARDED = "awarded"  # spec 10.2 point 6: every line approved (or excluded); PO data files generated


class Tender(Base):
    __tablename__ = "tenders"

    id = Column(Integer, primary_key=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    tender_type = Column(Enum(TenderType), nullable=False)
    status = Column(Enum(TenderStatus), nullable=False, default=TenderStatus.DRAFT)
    department = Column(String, nullable=True)
    awarded_at = Column(DateTime(timezone=True), nullable=True)

    # Spec §6.2 — tender-wide defaults, overridable per line item.
    min_rating_threshold = Column(Float, nullable=False, default=0.0)
    min_invites = Column(Integer, nullable=True)
    max_invites = Column(Integer, nullable=True)

    publish_date = Column(DateTime(timezone=True), nullable=True)
    bid_due_date = Column(DateTime(timezone=True), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)

    # Spec §7.3 — increments on every (re)submission; Round 1 on first.
    round_number = Column(Integer, nullable=False, default=0)
    # Spec §7.3 point 5 — consecutive rejections drive auto-escalation to
    # the next approval tier (app/services/approval_matrix.py); reset on
    # approval. Count, not a bool, so MAX_ROUNDS_BEFORE_ESCALATION is a
    # single comparison at submit time.
    consecutive_rejections = Column(Integer, nullable=False, default=0)

    created_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    facility = relationship("Facility")
    line_items = relationship("TenderLineItem", back_populates="tender", cascade="all, delete-orphan")
    approval_rounds = relationship(
        "TenderApprovalRound", back_populates="tender", cascade="all, delete-orphan", order_by="TenderApprovalRound.round_number"
    )
