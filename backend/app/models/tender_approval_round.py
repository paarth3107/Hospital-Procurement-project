import enum
from datetime import datetime, timezone

from sqlalchemy import Column, Enum, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from app.database import Base, UTCDateTime


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
    # Real bug, found 2026-10-16 -- see audit_log.py's AuditLog.occurred_at
    # for the full explanation (server_default=func.now() used the DB
    # server's own local timezone instead of true UTC).
    submitted_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))
    reviewer_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    comments = Column(Text, nullable=True)
    decided_at = Column(UTCDateTime(), nullable=True)

    tender = relationship("Tender", back_populates="approval_rounds")
