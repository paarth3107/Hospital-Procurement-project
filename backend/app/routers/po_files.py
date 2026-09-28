from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.award import PoDataFile
from app.models.user_account import Role, UserAccount
from app.security import require_role
from app.services import po_files
from app.services.audit import record

router = APIRouter(prefix="/api/v1/po-files", tags=["po-files"])

# Spec 10.5: Procurement Admin (here Procurement Admin / Category Manager, one
# job) takes the generated file to the ERP. Others can see the list but not
# the files: they carry vendor GSTIN and prices. Recording the ERP's import
# outcome and re-exporting a corrected file (spec 10.5 points 3-5, 10.7) are
# out of scope for now (user-directed, 2026-09-28) -- this app's job stops at
# the generated file.
MANAGERS = (Role.PROCUREMENT_ADMIN, Role.CATEGORY_MANAGER, Role.SYSTEM_ADMIN)
VIEWERS = MANAGERS + (Role.PROCUREMENT_OFFICER, Role.APPROVING_AUTHORITY)


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
