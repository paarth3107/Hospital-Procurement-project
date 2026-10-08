import enum

from sqlalchemy import JSON, Boolean, Column, Enum, Float, ForeignKey, Integer, String, Text, func

from app.database import Base, UTCDateTime
from app.models.user_account import Role


class OverrideType(str, enum.Enum):
    """The 8 override types spec §12.3 names as governed by this one engine.
    Every module that needs an override references one of these rather than
    inventing its own approval logic (spec §12.1/§12.2) -- most are not wired
    to a real target-record mutation yet (see backend/README.md and GAPS.md
    for which are); the engine itself works the same regardless."""

    PRICE_COMPETITIVENESS_OVERRIDE = "price_competitiveness_override"
    INVITE_LIST_MANUAL_ADD = "invite_list_manual_add"
    GUEST_VENDOR_INVITE = "guest_vendor_invite"
    TECHNICAL_SCORE_CORRECTION = "technical_score_correction"
    LATE_SUBMISSION_EXCEPTION = "late_submission_exception"
    DUE_DATE_EXTENSION = "due_date_extension"
    NON_L1_AWARD_OVERRIDE = "non_l1_award_override"
    PO_REEXPORT = "po_reexport"


class OverrideStatus(str, enum.Enum):
    """Spec §12.4's generic state machine, identical for every override type."""

    REQUESTED = "requested"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    ESCALATED = "escalated"
    EXPIRED = "expired"


class OverrideTypeConfig(Base):
    """Spec §12.3's table as hospital-configurable data (CLAUDE.md: "model as
    config, not a hardcoded hierarchy"), one row per OverrideType. Seeded
    with the spec's own illustrative values in app/seed.py -- same pattern as
    ApprovalBand for the E-Tender/L1 value matrix -- and, like that matrix,
    still to be finalized against the hospital's real delegation-of-authority
    policy (CLAUDE.md open question 2 names §12.3 bands explicitly)."""

    __tablename__ = "override_type_configs"

    id = Column(Integer, primary_key=True)
    override_type = Column(Enum(OverrideType), nullable=False, unique=True)

    default_approver_role = Column(Enum(Role), nullable=False)
    # Only meaningful when default_approver_role == APPROVING_AUTHORITY -- the
    # Role enum has no separate "Department Head" (see user_account.py's own
    # note on this), so a tier under that one role stands in, exactly as
    # approval_matrix.py already does for tender/L1 approval.
    default_approver_min_tier = Column(Integer, nullable=True)

    # spec §12.3's literal "(self-attested)" parenthetical -- only Guest
    # Vendor Invite and (first) Due-Date Extension carry it. True only means
    # a request from someone already holding default_approver_role clears
    # itself immediately (spec §12.5), still logged as its own Approved step.
    self_attested = Column(Boolean, nullable=False, default=False)

    escalate_to_role = Column(Enum(Role), nullable=True)
    escalate_to_min_tier = Column(Integer, nullable=True)

    # The value/count a request must exceed to resolve straight to
    # escalate_to_role instead of default_approver_role (spec §12.5's "Value/
    # Count Band, where applicable"). Meaning depends on the type (rupee
    # value, score points, a count) -- illustrative, not spec-fixed (spec
    # §12.3's own footnote, CLAUDE.md open question 2).
    escalation_threshold = Column(Float, nullable=True)

    # SLA window (spec §12.4 point 5/6): pending past this auto-escalates
    # once, then auto-expires if still unactioned. Evaluated lazily (no
    # scheduler in this app yet) whenever an override is read -- see
    # app/services/overrides.py's _apply_sla(). Illustrative default, not a
    # spec value.
    sla_hours = Column(Integer, nullable=True)


class OverrideRequest(Base):
    """One instance of spec §12.4's generic workflow. entity_type/entity_id
    point at whatever record the override concerns (a VendorRating, a
    BidTechnicalResult, a PoDataFile...) without an FK, the same polymorphic-
    reference pattern AuditLog already uses -- one engine, not one table per
    module. Applying an Approved override's effect to that target record is
    per-type logic added when that type is wired in (spec §12.1: the target
    record is untouched until Approved regardless); this table only tracks
    the workflow itself."""

    __tablename__ = "override_requests"

    id = Column(Integer, primary_key=True)
    override_type = Column(Enum(OverrideType), nullable=False, index=True)

    entity_type = Column(String(255), nullable=False)
    entity_id = Column(Integer, nullable=True)
    entity_label = Column(String(255), nullable=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)

    initiator_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=False)
    initiator_role = Column(Enum(Role), nullable=False)

    reason_code = Column(String(255), nullable=False)
    justification = Column(Text, nullable=False)
    # Free-form before/after the requester is asking to apply -- display/
    # record-keeping only in this pass (see class docstring).
    proposed_change = Column(JSON, nullable=True)

    status = Column(Enum(OverrideStatus), nullable=False, default=OverrideStatus.PENDING_APPROVAL, index=True)
    escalation_level = Column(Integer, nullable=False, default=0)
    required_approver_role = Column(Enum(Role), nullable=True)
    required_approver_min_tier = Column(Integer, nullable=True)
    sla_due_at = Column(UTCDateTime(), nullable=True)

    decided_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    decided_at = Column(UTCDateTime(), nullable=True)
    decision_reason = Column(Text, nullable=True)

    created_at = Column(UTCDateTime(), server_default=func.now(), nullable=False)
