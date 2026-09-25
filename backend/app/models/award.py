from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.database import Base

# Round status
DRAFT, PENDING, APPROVED, REJECTED = "draft", "pending", "approved", "rejected"
# Round kind
AWARD, EXCLUDE = "award", "exclude"
# Allocation stage
PROPOSED, FINAL = "proposed", "final"
# Decision kinds
APPROVED_RECOMMENDATION, AWARDED_SYSTEM_L1, APPROVED_ADJUSTED, REJECTED_DECISION = "approved_recommendation", "awarded_system_l1", "approved_adjusted", "rejected"


class AwardRound(Base):
    """One numbered round of the L1 recommendation / L1 approval cycle for one
    tender line (spec 9.5, 10.2, 7.3 point 9): the Officer's recommendation is
    a draft, becomes Pending when the tender is submitted for L1 approval, and
    the Approving Authority approves it or rejects it (a rejection keeps the
    round and the next draft is round N+1). Each line keeps its own history."""

    __tablename__ = "award_rounds"
    __table_args__ = (UniqueConstraint("line_item_id", "round_number", name="uq_award_round"),)

    id = Column(Integer, primary_key=True)
    line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False, index=True)
    round_number = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default=DRAFT)
    kind = Column(String, nullable=False, default=AWARD)  # award | exclude (line left out of the award)

    # What the system ranked first (L1, or C1 on QCBS lines) when the Officer recommended.
    system_top_bid_id = Column(Integer, ForeignKey("bids.id"), nullable=True)
    # True when the Officer's main pick is not the system's top-ranked bid; the
    # reason is then mandatory (spec 9.5: a governed override).
    is_override = Column(Boolean, nullable=False, default=False)
    officer_reason = Column(Text, nullable=True)
    recommended_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    recommended_at = Column(DateTime(timezone=True), server_default=func.now())

    submitted_at = Column(DateTime(timezone=True), nullable=True)
    required_tier = Column(Integer, nullable=True)  # resolved from the award value at submission
    award_value = Column(Float, nullable=True)

    decision_kind = Column(String, nullable=True)
    decided_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    decision_comments = Column(Text, nullable=True)

    line_item = relationship("TenderLineItem")
    decided_by = relationship("UserAccount", foreign_keys=[decided_by_id])
    recommended_by = relationship("UserAccount", foreign_keys=[recommended_by_id])
    allocations = relationship("AwardAllocation", back_populates="round", cascade="all, delete-orphan", order_by="AwardAllocation.id")


class AwardAllocation(Base):
    """How much of a line goes to which bid. `proposed` rows are the Officer's;
    `final` rows are what the Approving Authority approved (they may differ:
    the Authority confirms or adjusts a split, spec 10.2 point 3)."""

    __tablename__ = "award_allocations"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("award_rounds.id"), nullable=False, index=True)
    bid_id = Column(Integer, ForeignKey("bids.id"), nullable=False)
    share_pct = Column(Float, nullable=False)
    stage = Column(String, nullable=False, default=PROPOSED)

    round = relationship("AwardRound", back_populates="allocations")
    bid = relationship("Bid")


class PoDataFile(Base):
    """One PO data file per awarded vendor per tender (spec 10.3). The content
    is a frozen snapshot (`payload`) taken from the approved award; CSV / XML are
    rendered from it on download, so a file can never be edited by hand. A
    re-export after a failed import makes a new version and supersedes (never
    deletes) the old one (spec 10.7)."""

    __tablename__ = "po_data_files"

    id = Column(Integer, primary_key=True)
    batch_id = Column(String, nullable=False, unique=True)
    tender_id = Column(Integer, ForeignKey("tenders.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default="pending_upload")  # pending_upload | imported | import_failed | superseded
    payload = Column(JSON, nullable=False)
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    generated_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)  # the approving authority
    supersedes_id = Column(Integer, ForeignKey("po_data_files.id"), nullable=True)
    erp_po_number = Column(String, nullable=True)
    status_reason = Column(Text, nullable=True)  # ERP rejection reason, or the re-export reason
    status_changed_at = Column(DateTime(timezone=True), nullable=True)
    status_changed_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)

    tender = relationship("Tender")
    vendor = relationship("Vendor")
    generated_by = relationship("UserAccount", foreign_keys=[generated_by_id])


class Notification(Base):
    """A message to a vendor (award, regret, technical disqualification). There
    is no email/SMS adapter yet, so the portal notification is the delivery and
    the sending is logged (CLAUDE.md: adapters + mocks, not faked)."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False, index=True)
    kind = Column(String, nullable=False)  # awarded | regret | technical_disqualified
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    tender_id = Column(Integer, ForeignKey("tenders.id"), nullable=True)
    data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    read_at = Column(DateTime(timezone=True), nullable=True)
