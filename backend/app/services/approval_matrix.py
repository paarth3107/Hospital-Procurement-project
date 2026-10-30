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

    # No estimated prices entered on any line yet (routers/tenders.py's
    # _total_estimated_value() treats a blank estimated_price as 0) is "we
    # don't know the value yet," not a genuine value this system can't
    # route -- a missing/misconfigured tier-1 band shouldn't block
    # submission over it (2026-10-30, user-directed). Defaults to tier 1
    # (the lowest), using a real configured tier-1 band's label when one
    # exists. Deliberately scoped to total_value <= 0 only: a genuine
    # nonzero value landing in an actual gap between configured bands still
    # raises below, same as always -- this must never quietly extend to
    # "any unmatched value defaults to the lowest tier," which would just
    # recreate the same under-tiering risk for a real priced tender.
    if total_value <= 0:
        tier1 = next((b for b in candidates if b.tier == 1), None)
        return ResolvedTier(tier=1, label=tier1.label if tier1 else "Tier 1")

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
    # Approving Authority only, at every value (user-directed: Procurement
    # Admin no longer self-attests the lowest band).
    return user.role == Role.APPROVING_AUTHORITY and (user.approval_tier or 0) >= required_tier
