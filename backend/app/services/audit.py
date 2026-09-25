import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.user_account import UserAccount
from app.models.vendor import Vendor

# Keys that must never be written to the audit log, whatever a caller passes:
# personal/financial identifiers (they're masked in the UI too), credentials,
# and sealed-bid prices (spec §9.6 -- the log must not become a back door to
# prices before the bid deadline).
FORBIDDEN_KEYS = {
    "password", "hashed_password", "gstin", "pan", "bank_account_number", "bank_ifsc",
    "phone", "escalation_contact_phone", "unit_price", "price",
}


def _clean(value):
    """Make a value JSON-safe and strip forbidden keys."""
    if isinstance(value, dict):
        return {str(k): ("[not recorded]" if str(k) in FORBIDDEN_KEYS else _clean(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_clean(v) for v in value]
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def record(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    *,
    actor: UserAccount | Vendor | None = None,
    entity_label: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    reason: str | None = None,
    facility_id: int | None = None,
    meta: dict | None = None,
    actor_label: str | None = None,
) -> AuditLog:
    """Adds one audit row to the caller's session, so it commits (or rolls
    back) together with the change it describes. `actor` is a staff
    UserAccount, a Vendor, or None for the system (sweeps, auto-actions)."""

    if isinstance(actor, UserAccount):
        actor_type, actor_id, actor_name, actor_role = "staff", actor.id, actor.full_name, actor.role.value
    elif isinstance(actor, Vendor):
        actor_type, actor_id, actor_name, actor_role = "vendor", actor.id, actor.legal_name, "vendor"
    elif actor_label:  # someone who never authenticated (a failed login attempt)
        actor_type, actor_id, actor_name, actor_role = "anonymous", None, actor_label, None
    else:
        actor_type, actor_id, actor_name, actor_role = "system", None, "System", None
    row = AuditLog(
        actor_type=actor_type,
        actor_id=actor_id,
        actor_name=actor_name,
        actor_role=actor_role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        facility_id=facility_id,
        before_state=_clean(before) if before is not None else None,
        after_state=_clean(after) if after is not None else None,
        reason=reason,
        meta=_clean(meta) if meta is not None else None,
    )
    db.add(row)
    return row


def snapshot(obj, fields) -> dict:
    """Current values of `fields` on an ORM object (copied, so later edits don't alias)."""
    return {f: _clean(getattr(obj, f)) for f in fields}


def changed(before: dict, after: dict) -> tuple[dict, dict]:
    """Only the keys whose value differs, as (before, after)."""
    keys = [k for k in after if before.get(k) != after.get(k)]
    return {k: before.get(k) for k in keys}, {k: after[k] for k in keys}


def staff_actor(db: Session, user_id: int | None) -> UserAccount | None:
    """For services that only carry an actor id (status / mapping helpers)."""
    return db.get(UserAccount, user_id) if user_id else None
