from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.approval_band import ApprovalBand
from app.models.user_account import Role, UserAccount

# Spec §7.3 point 5: a configurable max-round count auto-escalates to the
# next Approving Authority tier rather than looping indefinitely. The exact
# count isn't spec'd (CLAUDE.md open question 2) — this is an illustrative
# default, not a spec value.
MAX_ROUNDS_BEFORE_ESCALATION = 3

MAX_TIER = 3


@dataclass
class ResolvedTier:
    tier: int
    label: str


def resolve_required_tier(total_value: float, facility_id: int, db: Session) -> ResolvedTier:
    """Spec §11.2 value-based approval matrix. Prefers a facility-specific
    band over a group-wide one (facility_id IS NULL) for the same value,
    since CLAUDE.md leaves group-wide-vs-facility-specific an open policy
    choice per hospital rather than fixing one (open question 3)."""

    bands = (
        db.query(ApprovalBand)
        .filter((ApprovalBand.facility_id == facility_id) | (ApprovalBand.facility_id.is_(None)))
        .all()
    )
    facility_bands = [b for b in bands if b.facility_id == facility_id]
    candidates = facility_bands or bands

    for band in candidates:
        if total_value >= band.min_value and (band.max_value is None or total_value < band.max_value):
            return ResolvedTier(tier=band.tier, label=band.label)

    raise ValueError(f"No approval band configured covers value {total_value} for facility {facility_id}")


def escalate(tier: int) -> int:
    return min(tier + 1, MAX_TIER)


def can_approve_tier(user: UserAccount, required_tier: int) -> bool:
    """Pure predicate version of tenders.py's _authorize_approver (which
    raises instead of returning) -- shared so the Dashboard's "Pending Your
    Approval" count/list uses the exact same rule as the endpoint that
    actually enforces it, rather than a second guess at the same logic."""

    if user.role == Role.SYSTEM_ADMIN:
        return True
    if required_tier <= 1:
        return user.role in (Role.PROCUREMENT_ADMIN, Role.APPROVING_AUTHORITY)
    return user.role == Role.APPROVING_AUTHORITY and (user.approval_tier or 0) >= required_tier
