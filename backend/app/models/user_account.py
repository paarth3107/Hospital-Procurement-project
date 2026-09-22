import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.orm import relationship

from app.database import Base


class Role(str, enum.Enum):
    """Internal hospital-staff roles (spec §11.1). Vendors are a separate
    entity/table, not a Role here — a vendor never logs in as a "user"
    in this table."""

    PROCUREMENT_OFFICER = "procurement_officer"
    PROCUREMENT_ADMIN = "procurement_admin"
    CATEGORY_MANAGER = "category_manager"
    APPROVING_AUTHORITY = "approving_authority"
    SYSTEM_ADMIN = "system_admin"


class UserAccount(Base):
    __tablename__ = "user_accounts"

    id = Column(Integer, primary_key=True)
    email = Column(String, nullable=False, unique=True, index=True)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(Enum(Role), nullable=False)

    # Nullable = scoped to every facility (e.g. System Admin). A single FK is
    # a simplification of spec §2.3's facility_scope[] for this first pass;
    # move to a many-to-many table if/when a user needs more than one
    # facility but not all of them.
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)

    # Spec §11.2 value-based approval matrix — only meaningful when
    # role == APPROVING_AUTHORITY. There's no separate "Department Head" /
    # "Finance Committee" role in this system's Role enum (CLAUDE.md's role
    # list has just one Approving Authority role), so the matrix's tiers are
    # modeled as a numeric level on that role rather than inventing roles the
    # spec doesn't otherwise define. See app/services/approval_matrix.py.
    approval_tier = Column(Integer, nullable=True)

    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    facility = relationship("Facility", back_populates="users")
