from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.award import PoDataFile
from app.models.user_account import Role, UserAccount
from app.security import require_role
from app.services import po_files
from app.services.audit import record

router = APIRouter(prefix="/api/v1/po-files", tags=["po-files"])

# Spec 10.5: Procurement Admin (here Procurement Admin / Category Manager, one
# job) takes the generated file to the ERP and records the outcome. Others can
# see the list but not the files: they carry vendor GSTIN and prices.
MANAGERS = (Role.PROCUREMENT_ADMIN, Role.CATEGORY_MANAGER, Role.SYSTEM_ADMIN)
VIEWERS = MANAGERS + (Role.PROCUREMENT_OFFICER, Role.APPROVING_AUTHORITY)


class ImportedIn(BaseModel):
    erp_po_number: str


class ReasonIn(BaseModel):
    reason: str


def _get(db: Session, po_id: int) -> PoDataFile:
    po = db.get(PoDataFile, po_id)
    if not po:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PO data file not found")
    return po


def _brief(po: PoDataFile) -> dict:
    lines = po.payload["lines"]
    return {
        "id": po.id, "batch_id": po.batch_id, "tender_id": po.tender_id, "tender_title": po.tender.title, "vendor_id": po.vendor_id,
        "vendor_name": po.vendor.legal_name, "vendor_code": po.payload["vendor"]["code"], "version": po.version, "status": po.status,
        "lines": len(lines), "total_incl_tax": round(sum(l["line_total_incl_tax"] for l in lines), 2), "generated_at": po.generated_at,
        "approved_by": po.payload["approval"]["approver_name"], "erp_po_number": po.erp_po_number, "status_reason": po.status_reason,
        "status_changed_at": po.status_changed_at, "supersedes_id": po.supersedes_id,
    }


@router.get("")
def list_files(status_filter: str | None = None, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*VIEWERS))):
    q = db.query(PoDataFile)
    if status_filter:
        q = q.filter(PoDataFile.status == status_filter)
    return [_brief(p) for p in q.order_by(PoDataFile.id.desc()).all()]


@router.get("/{po_id}")
def get_file(po_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*MANAGERS))):
    po = _get(db, po_id)
    return {**_brief(po), "payload": po.payload}


@router.get("/{po_id}/download")
def download(po_id: int, format: str = Query("csv", pattern="^(csv|xml)$"), db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*MANAGERS))):
    po = _get(db, po_id)
    content = po_files.render_csv(po.payload) if format == "csv" else po_files.render_xml(po.payload)
    record(db, "po_file.downloaded", "po_file", po.id, actor=user, entity_label=po.batch_id, facility_id=po.tender.facility_id, meta={"format": format, "version": po.version})
    db.commit()
    return Response(
        content=content, media_type="text/csv" if format == "csv" else "application/xml",
        headers={"Content-Disposition": f'attachment; filename="{po.batch_id}.{format}"'},
    )


def _change(db: Session, po: PoDataFile, new_status: str, user: UserAccount, action: str, reason: str | None = None, po_number: str | None = None):
    before = po.status
    po.status, po.status_reason = new_status, reason
    if po_number is not None:
        po.erp_po_number = po_number
    po.status_changed_at, po.status_changed_by_id = datetime.now(timezone.utc), user.id
    record(
        db, action, "po_file", po.id, actor=user, entity_label=po.batch_id, facility_id=po.tender.facility_id, reason=reason,
        before={"status": before}, after={"status": new_status}, meta={"erp_po_number": po_number} if po_number else None,
    )


@router.post("/{po_id}/mark-imported")
def mark_imported(po_id: int, payload: ImportedIn, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*MANAGERS))):
    """Spec 10.5 point 3: the ERP created the PO; record its number (manual
    reconciliation, as no return channel exists yet)."""
    po = _get(db, po_id)
    if po.status != "pending_upload":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This file is '{po.status}', not pending upload")
    number = payload.erp_po_number.strip()
    if not number:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter the ERP PO number")
    _change(db, po, "imported", user, "po_file.imported", po_number=number)
    db.commit()
    return _brief(po)


@router.post("/{po_id}/mark-failed")
def mark_failed(po_id: int, payload: ReasonIn, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*MANAGERS))):
    """Spec 10.5 point 4: the ERP rejected the file; keep its reason."""
    po = _get(db, po_id)
    if po.status != "pending_upload":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This file is '{po.status}', not pending upload")
    if not payload.reason.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Record the ERP's rejection reason")
    _change(db, po, "import_failed", user, "po_file.import_failed", reason=payload.reason.strip())
    db.commit()
    return _brief(po)


@router.post("/{po_id}/re-export")
def re_export(po_id: int, payload: ReasonIn, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*MANAGERS))):
    """Spec 10.5 point 5 / 10.7: a corrected file is a new version that
    supersedes the failed one. Spec 12 makes this a governed override; the
    override engine is not built yet, so it is recorded as an audited action
    that cannot change any approved price or quantity."""
    po = _get(db, po_id)
    new = po_files.re_export(db, po, user, payload.reason)
    record(
        db, "po_file.re_exported", "po_file", new.id, actor=user, entity_label=new.batch_id, facility_id=po.tender.facility_id, reason=payload.reason.strip(),
        before={"status": "import_failed"}, after={"status": "pending_upload"}, meta={"supersedes": po.batch_id, "version": new.version},
    )
    db.commit()
    return _brief(new)
