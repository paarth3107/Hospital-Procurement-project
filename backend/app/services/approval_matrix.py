from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.approval_band import ApprovalBand

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
