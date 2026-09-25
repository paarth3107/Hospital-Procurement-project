import enum

from sqlalchemy import JSON, Column, DateTime, Enum, Float, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base


class TechnicalDecision(str, enum.Enum):
    QUALIFIED = "qualified"
    DISQUALIFIED = "disqualified"


class BidEvaluation(Base):
    """One evaluator's technical assessment of one bid (spec §9.2.3 step 2-3:
    each evaluator's individual score is retained; the consolidated result is
    computed from all of them). Editable until the line's technical evaluation
    is closed -- after that a change is a governed override (spec §9.2.4)."""

    __tablename__ = "bid_evaluations"
    __table_args__ = (UniqueConstraint("bid_id", "evaluator_id", name="uq_bid_evaluation_evaluator"),)

    id = Column(Integer, primary_key=True)
    bid_id = Column(Integer, ForeignKey("bids.id"), nullable=False, index=True)
    evaluator_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False)
    decision = Column(Enum(TechnicalDecision), nullable=False)
    scores = Column(JSON, nullable=False, default=dict)  # criterion -> 0..100 (scored lines only)
    weighted_score = Column(Float, nullable=True)  # this evaluator's weighted total (scored lines only)
    comments = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    bid = relationship("Bid", backref="evaluations")
    evaluator = relationship("UserAccount")


class BidTechnicalResult(Base):
    """The recorded technical outcome per bid, written when a line's technical
    evaluation is closed: qualified / disqualified, the consolidated score and
    the T-rank (T1 = highest-scoring qualified bid). Only qualified bids ever
    have their prices opened for commercial evaluation (spec §9.2.4)."""

    __tablename__ = "bid_technical_results"

    id = Column(Integer, primary_key=True)
    bid_id = Column(Integer, ForeignKey("bids.id"), nullable=False, unique=True)
    outcome = Column(Enum(TechnicalDecision), nullable=False)
    consolidated_score = Column(Float, nullable=True)
    t_rank = Column(Integer, nullable=True)
    reason = Column(Text, nullable=True)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())

    bid = relationship("Bid", backref="technical_result", uselist=False)


class BidAttachmentView(Base):
    """An evaluator opened a vendor's attachment. Scoring a bid is refused until
    the evaluator has opened every attachment on it (spec 8.3.3 logs each view;
    this table is what the rule is enforced from)."""

    __tablename__ = "bid_attachment_views"
    __table_args__ = (UniqueConstraint("attachment_id", "viewer_id", name="uq_attachment_viewer"),)

    id = Column(Integer, primary_key=True)
    attachment_id = Column(Integer, ForeignKey("bid_attachments.id"), nullable=False, index=True)
    viewer_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False)
    viewed_at = Column(DateTime(timezone=True), server_default=func.now())
