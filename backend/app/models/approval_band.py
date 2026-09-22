from sqlalchemy import Column, Float, ForeignKey, Integer, String

from app.database import Base


class ApprovalBand(Base):
    """Spec §11.2 value-based approval matrix — hospital-configurable data,
    not a hardcoded hierarchy (CLAUDE.md: "model as config"). A tender's
    total estimated value resolves to a `tier`; the approving user must hold
    that tier (or higher) on their UserAccount.approval_tier — see
    app/services/approval_matrix.py. `facility_id` NULL means a group-wide
    band that applies to any facility without its own override (CLAUDE.md
    open question 3 leaves group-wide-vs-facility-specific unresolved, so
    both are supported)."""

    __tablename__ = "approval_bands"

    id = Column(Integer, primary_key=True)
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)
    min_value = Column(Float, nullable=False)
    max_value = Column(Float, nullable=True)  # NULL = open-ended (no upper bound)
    tier = Column(Integer, nullable=False)
    label = Column(String, nullable=False)  # descriptive only, e.g. "Department Head"
