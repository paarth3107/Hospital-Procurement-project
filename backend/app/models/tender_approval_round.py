import enum

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, Text, func
from sqlalchemy.orm import relationship

from app.database import Base


class RoundDecision(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class TenderApprovalRound(Base):
    """Spec §7.3 — every submission is a numbered round with its own
    snapshot (who reviewed it, decision, comments, timestamps); a rejection
    never overwrites a prior round's record."""

    __tablename__ = "tender_approval_rounds"

    id = Column(Integer, primary_key=True)
    tender_id = Column(Integer, ForeignKey("tenders.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    decision = Column(Enum(RoundDecision), nullable=False, default=RoundDecision.PENDING)

    # Snapshot of the approval-matrix resolution at submission time (spec
    # §7.2 point 4) — kept even if the matrix config changes later.
    required_tier = Column(Integer, nullable=False)

    submitted_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    reviewer_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    comments = Column(Text, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)

    tender = relationship("Tender", back_populates="approval_rounds")
