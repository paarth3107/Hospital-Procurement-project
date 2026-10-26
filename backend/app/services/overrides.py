from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.override import OverrideRequest, OverrideStatus, OverrideType, OverrideTypeConfig
from app.models.staff_notification import StaffNotification
from app.models.user_account import Role, UserAccount
from app.services.audit import record

# Spec §12.4 point 5/6: "a configured SLA window" -- illustrative, not a spec
# value (same footing as MAX_ROUNDS_BEFORE_ESCALATION in approval_matrix.py),
# used to seed every OverrideTypeConfig row in app/seed.py.
DEFAULT_SLA_HOURS = 48

# Mirrors frontend/src/lib/constants.ts's OVERRIDE_TYPE_LABELS -- same
# spec §12.3 names, kept in sync by hand since one's TS and one's Python.
OVERRIDE_TYPE_LABELS: dict[OverrideType, str] = {
    OverrideType.PRICE_COMPETITIVENESS_OVERRIDE: "Price Competitiveness Override",
    OverrideType.INVITE_LIST_MANUAL_ADD: "Invite List Manual Add",
    OverrideType.GUEST_VENDOR_INVITE: "Expedited Registration Review",
    OverrideType.TECHNICAL_SCORE_CORRECTION: "Technical Score Correction",
    OverrideType.LATE_SUBMISSION_EXCEPTION: "Late-Submission Exception",
    OverrideType.DUE_DATE_EXTENSION: "Bid Due-Date Extension",
    OverrideType.NON_L1_AWARD_OVERRIDE: "Non-L1 Award Override",
    OverrideType.PO_REEXPORT: "PO Re-export",
}


def _notify_initiator(db: Session, override: OverrideRequest, *, approved: bool) -> None:
    """Spec §12 (user-directed, 2026-10-22): the requester finds out their
    override was decided, without having to go back and check. Deliberately
    terse -- one line, no justification/history dump -- "small, precise,
    just informatory" per the request. Centralized here rather than in each
    router's approve/reject endpoint so every override type gets this for
    free, including ones wired in later."""

    label = OVERRIDE_TYPE_LABELS.get(override.override_type, override.override_type.value.replace("_", " "))
    if approved:
        title = f"{label} approved"
        body = f"Your {label.lower()} request for {override.entity_label or 'this item'} was approved."
    else:
        title = f"{label} declined"
        body = f"Your {label.lower()} request for {override.entity_label or 'this item'} was declined."
        if override.decision_reason:
            body += f" Reason: {override.decision_reason}"
    db.add(
        StaffNotification(
            user_id=override.initiator_id, kind="override_approved" if approved else "override_rejected", title=title, body=body
        )
    )


def can_decide(user: UserAccount, override: OverrideRequest) -> bool:
    """Mirrors approval_matrix.py's can_approve_tier: System Admin is a
    catch-all, otherwise the decider must hold the currently-resolved
    approver role at least at the currently-resolved tier."""

    if user.role == Role.SYSTEM_ADMIN:
        return True
    if user.role != override.required_approver_role:
        return False
    if override.required_approver_min_tier is None:
        return True
    return (user.approval_tier or 0) >= override.required_approver_min_tier


def _get_config(db: Session, override_type: OverrideType) -> OverrideTypeConfig:
    config = db.query(OverrideTypeConfig).filter(OverrideTypeConfig.override_type == override_type).first()
    if not config:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"No override configuration seeded for '{override_type.value}'")
    return config


def create_override(
    db: Session,
    *,
    override_type: OverrideType,
    initiator: UserAccount,
    entity_type: str,
    justification: str,
    entity_id: int | None = None,
    entity_label: str | None = None,
    facility_id: int | None = None,
    proposed_change: dict | None = None,
    trigger_value: float | None = None,
) -> OverrideRequest:
    """Spec §12.4 steps 1-2 in one call: records the Requested state, then
    immediately resolves the required approver (§12.5) and advances to
    Pending Approval -- or, for a self-attested type requested by someone who
    already holds the default approver role/tier, straight to Approved
    (§12.5: "still recorded as a distinct Approved step -- auto-approved
    within that authority, not skipped"). The target record referenced by
    entity_type/entity_id is never touched here (§12.1/§12.2)."""

    if not justification.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A justification is required")

    config = _get_config(db, override_type)

    level = 0
    role, tier = config.default_approver_role, config.default_approver_min_tier
    if trigger_value is not None and config.escalation_threshold is not None and config.escalate_to_role and trigger_value > config.escalation_threshold:
        level = 1
        role, tier = config.escalate_to_role, config.escalate_to_min_tier

    def _holds(r: Role | None, t: int | None) -> bool:
        return r is not None and initiator.role == r and (t is None or (initiator.approval_tier or 0) >= t)

    # Real bug, found 2026-10-22: this used to only check initiator.role ==
    # role (the role resolved at THIS level), so a self-attested type
    # requested by anyone other than the exact default-approver role fell
    # straight to "needs a decision from <default role>" -- even when the
    # initiator already outranks that role for this exact type. A type's
    # own escalate_to_role is, by construction, a higher authority for it
    # than the default (that's what escalation IS), and System Admin is
    # already a universal decider everywhere else (can_decide above) -- both
    # should clear a self-attested type on their own say-so, at any level,
    # same as the default role does at level 0. (The default-role match
    # itself stays level==0-only: once a request has escalated past the
    # value/count threshold, that's specifically meant to require the
    # escalation target's sign-off even from someone who'd otherwise
    # self-attest -- that's the whole point of escalating.)
    auto_approve = config.self_attested and (
        initiator.role == Role.SYSTEM_ADMIN
        or (level == 0 and _holds(config.default_approver_role, config.default_approver_min_tier))
        or _holds(config.escalate_to_role, config.escalate_to_min_tier)
    )

    now = datetime.now(timezone.utc)
    override = OverrideRequest(
        override_type=override_type,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        facility_id=facility_id,
        initiator_id=initiator.id,
        initiator_role=initiator.role,
        justification=justification.strip(),
        proposed_change=proposed_change,
        escalation_level=level,
        required_approver_role=role,
        required_approver_min_tier=tier,
        status=OverrideStatus.APPROVED if auto_approve else OverrideStatus.PENDING_APPROVAL,
        sla_due_at=None if auto_approve or not config.sla_hours else now + timedelta(hours=config.sla_hours),
    )
    if auto_approve:
        override.decided_by_id = initiator.id
        override.decided_at = now
        override.decision_reason = "Self-attested within delegated authority"
    db.add(override)
    db.flush()

    record(
        db, "override.requested", "override_request", override.id, actor=initiator, entity_label=entity_label or override_type.value,
        facility_id=facility_id, reason=justification.strip(),
        after={"override_type": override_type, "justification": justification.strip(), "required_approver_role": role, "escalation_level": level},
        meta={"entity_type": entity_type, "entity_id": entity_id},
    )
    if auto_approve:
        record(
            db, "override.approved", "override_request", override.id, actor=initiator, entity_label=entity_label or override_type.value,
            facility_id=facility_id, reason=override.decision_reason,
            before={"status": OverrideStatus.PENDING_APPROVAL}, after={"status": OverrideStatus.APPROVED},
        )
    return override


def _apply_sla(db: Session, override: OverrideRequest) -> None:
    """Lazy SLA sweep (no scheduler in this app -- see DEFAULT_SLA_HOURS):
    evaluated whenever an override is read. A window breach escalates once
    (§12.4 state 5); breaching it again with nowhere left to escalate to
    expires it (§12.4 state 6)."""

    if override.status not in (OverrideStatus.PENDING_APPROVAL, OverrideStatus.ESCALATED) or override.sla_due_at is None:
        return
    if datetime.now(timezone.utc) < override.sla_due_at:
        return

    config = _get_config(db, override.override_type)
    if override.escalation_level == 0 and config.escalate_to_role:
        _escalate(db, override, config, actor=None, reason="SLA window breached — auto-escalated")
    else:
        before = {"status": override.status}
        override.status = OverrideStatus.EXPIRED
        override.decided_at = datetime.now(timezone.utc)
        override.decision_reason = "Expired — no decision within the configured SLA window"
        record(
            db, "override.expired", "override_request", override.id, entity_label=override.entity_label or override.override_type.value,
            facility_id=override.facility_id, before=before, after={"status": OverrideStatus.EXPIRED},
        )


def _escalate(db: Session, override: OverrideRequest, config: OverrideTypeConfig, *, actor: UserAccount | None, reason: str) -> None:
    before = {"status": override.status, "required_approver_role": override.required_approver_role}
    override.status = OverrideStatus.ESCALATED
    override.escalation_level = 1
    override.required_approver_role = config.escalate_to_role
    override.required_approver_min_tier = config.escalate_to_min_tier
    override.sla_due_at = datetime.now(timezone.utc) + timedelta(hours=config.sla_hours) if config.sla_hours else None
    record(
        db, "override.escalated", "override_request", override.id, actor=actor, entity_label=override.entity_label or override.override_type.value,
        facility_id=override.facility_id, reason=reason, before=before,
        after={"status": OverrideStatus.ESCALATED, "required_approver_role": config.escalate_to_role},
    )


def get_override(db: Session, override_id: int) -> OverrideRequest:
    override = db.get(OverrideRequest, override_id)
    if not override:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Override request not found")
    _apply_sla(db, override)
    return override


def list_overrides(db: Session, *, status_filter: OverrideStatus | None = None, override_type: OverrideType | None = None) -> list[OverrideRequest]:
    query = db.query(OverrideRequest)
    if override_type is not None:
        query = query.filter(OverrideRequest.override_type == override_type)
    rows = query.order_by(OverrideRequest.created_at.desc()).all()
    for row in rows:
        _apply_sla(db, row)
    if status_filter is not None:
        rows = [r for r in rows if r.status == status_filter]
    return rows


def escalate_override(db: Session, override: OverrideRequest, actor: UserAccount | None, reason: str) -> OverrideRequest:
    """Escalation outside the request-time value-band routing in
    create_override(): either a human raising it manually (spec §12.4 state
    5's "value/count crosses a trigger", for a type with no numeric band --
    see the technical-score-correction wiring, which detects the
    qualification-outcome change itself and passes actor=None here, same as
    the automatic SLA sweep) or an approver's own judgment call."""

    if override.status != OverrideStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Override is '{override.status.value}', not pending approval")
    if override.escalation_level != 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already escalated once — this engine models a single escalation tier per type")
    config = _get_config(db, override.override_type)
    if not config.escalate_to_role:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No further escalation is configured for this override type")
    if not reason.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to escalate")
    _escalate(db, override, config, actor=actor, reason=reason.strip())
    return override


def approve_override(db: Session, override: OverrideRequest, approver: UserAccount, decision_reason: str | None) -> OverrideRequest:
    """Spec §12.4 state 3. Only completes the workflow -- applying the
    approved change to the target record (entity_type/entity_id) is
    per-override-type logic added when that type is wired into this engine
    (see backend/README.md); nothing here mutates it yet."""

    if override.status not in (OverrideStatus.PENDING_APPROVAL, OverrideStatus.ESCALATED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Override is '{override.status.value}', not awaiting a decision")
    if not can_decide(approver, override):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Requires role '{override.required_approver_role.value}' (or higher) to decide this override")

    before = {"status": override.status}
    override.status = OverrideStatus.APPROVED
    override.decided_by_id = approver.id
    override.decided_at = datetime.now(timezone.utc)
    override.decision_reason = decision_reason.strip() if decision_reason else None
    record(
        db, "override.approved", "override_request", override.id, actor=approver, entity_label=override.entity_label or override.override_type.value,
        facility_id=override.facility_id, reason=override.decision_reason, before=before, after={"status": OverrideStatus.APPROVED},
    )
    _notify_initiator(db, override, approved=True)
    return override


def reject_override(db: Session, override: OverrideRequest, approver: UserAccount, decision_reason: str) -> OverrideRequest:
    """Spec §12.4 state 4 -- rejection reason is mandatory, and the
    underlying record (never touched to begin with) is simply left alone."""

    if override.status not in (OverrideStatus.PENDING_APPROVAL, OverrideStatus.ESCALATED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Override is '{override.status.value}', not awaiting a decision")
    if not can_decide(approver, override):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Requires role '{override.required_approver_role.value}' (or higher) to decide this override")
    if not decision_reason.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to reject an override")

    before = {"status": override.status}
    override.status = OverrideStatus.REJECTED
    override.decided_by_id = approver.id
    override.decided_at = datetime.now(timezone.utc)
    override.decision_reason = decision_reason.strip()
    record(
        db, "override.rejected", "override_request", override.id, actor=approver, entity_label=override.entity_label or override.override_type.value,
        facility_id=override.facility_id, reason=override.decision_reason, before=before, after={"status": OverrideStatus.REJECTED},
    )
    _notify_initiator(db, override, approved=False)
    return override
