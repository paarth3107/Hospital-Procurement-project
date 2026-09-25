import csv
import io
import json
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.user_account import Role, UserAccount
from app.schemas.audit import AuditFilterOptions, AuditLogOut, AuditLogPage
from app.security import require_role

router = APIRouter(prefix="/api/v1/audit-log", tags=["audit-log"])

# Read-only, and System Admin only (user-directed). There is deliberately no
# POST/PUT/DELETE here: rows are written only from inside the services that
# make the change, and the database itself refuses UPDATE / DELETE.
require_admin = require_role(Role.SYSTEM_ADMIN)

EXPORT_LIMIT = 50_000


def _filtered(
    db: Session,
    entity_type: str | None,
    entity_id: int | None,
    action: str | None,
    actor_type: str | None,
    actor_id: int | None,
    facility_id: int | None,
    date_from: date | None,
    date_to: date | None,
    search: str | None,
) -> SAQuery:
    q = db.query(AuditLog)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        q = q.filter(AuditLog.entity_id == entity_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if actor_type:
        q = q.filter(AuditLog.actor_type == actor_type)
    if actor_id is not None:
        q = q.filter(AuditLog.actor_id == actor_id)
    if facility_id is not None:
        q = q.filter(AuditLog.facility_id == facility_id)
    if date_from:
        q = q.filter(AuditLog.occurred_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        q = q.filter(AuditLog.occurred_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(AuditLog.entity_label.ilike(like), AuditLog.actor_name.ilike(like), AuditLog.reason.ilike(like)))
    return q


@router.get("", response_model=AuditLogPage)
def list_audit_log(
    entity_type: str | None = None,
    entity_id: int | None = None,
    action: str | None = None,
    actor_type: str | None = None,
    actor_id: int | None = None,
    facility_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: UserAccount = Depends(require_admin),
):
    q = _filtered(db, entity_type, entity_id, action, actor_type, actor_id, facility_id, date_from, date_to, search)
    total = q.count()
    items = q.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return AuditLogPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/filters", response_model=AuditFilterOptions)
def filter_options(db: Session = Depends(get_db), _admin: UserAccount = Depends(require_admin)):
    return AuditFilterOptions(
        entity_types=[r[0] for r in db.query(AuditLog.entity_type).distinct().order_by(AuditLog.entity_type)],
        actions=[r[0] for r in db.query(AuditLog.action).distinct().order_by(AuditLog.action)],
    )


@router.get("/export")
def export_audit_log(
    entity_type: str | None = None,
    entity_id: int | None = None,
    action: str | None = None,
    actor_type: str | None = None,
    actor_id: int | None = None,
    facility_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _admin: UserAccount = Depends(require_admin),
):
    """CSV of the current filter (newest first, capped), for auditors."""
    q = _filtered(db, entity_type, entity_id, action, actor_type, actor_id, facility_id, date_from, date_to, search)
    rows = q.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc()).limit(EXPORT_LIMIT).all()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id", "when", "actor_type", "actor", "role", "action", "entity_type", "entity_id", "entity", "facility_id", "reason", "before", "after", "meta", "imported"])
    for r in rows:
        w.writerow(
            [
                r.id, r.occurred_at.isoformat(), r.actor_type, r.actor_name, r.actor_role, r.action, r.entity_type, r.entity_id,
                r.entity_label, r.facility_id, r.reason,
                json.dumps(r.before_state) if r.before_state is not None else "",
                json.dumps(r.after_state) if r.after_state is not None else "",
                json.dumps(r.meta) if r.meta is not None else "",
                r.imported,
            ]
        )
    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'},
    )
