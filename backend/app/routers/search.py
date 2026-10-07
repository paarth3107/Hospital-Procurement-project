from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product_master import ProductMaster
from app.models.tender import Tender
from app.models.user_account import UserAccount
from app.models.vendor import Vendor
from app.security import get_current_user

router = APIRouter(prefix="/api/v1/search", tags=["search"])

RESULTS_PER_GROUP = 5


@router.get("")
def global_search(
    q: str = Query(min_length=1, max_length=100),
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    """Staff-only quick search for the top navbar: vendors, tenders and catalog
    entries, matched on name/identifier and capped per group. Vendor tokens are
    refused by get_current_user, so vendors never see this."""
    like = f"%{q.strip()}%"
    vendors = (
        db.query(Vendor)
        .filter(or_(Vendor.legal_name.ilike(like), Vendor.gstin.ilike(like), Vendor.pan.ilike(like)))
        .order_by(Vendor.legal_name)
        .limit(RESULTS_PER_GROUP)
        .all()
    )
    tenders = db.query(Tender).filter(Tender.title.ilike(like)).order_by(Tender.id.desc()).limit(RESULTS_PER_GROUP).all()
    products = (
        db.query(ProductMaster)
        .filter(or_(ProductMaster.name.ilike(like), ProductMaster.code.ilike(like)))
        .order_by(ProductMaster.code)
        .limit(RESULTS_PER_GROUP)
        .all()
    )
    return {
        "vendors": [{"id": v.id, "label": v.legal_name, "sub": f"V-{v.id} · {v.status.value.replace('_', ' ')}"} for v in vendors],
        "tenders": [{"id": t.id, "label": t.title, "sub": f"Tender #{t.id} · {t.status.value.replace('_', ' ')}"} for t in tenders],
        "products": [{"id": p.id, "label": p.name, "sub": p.code} for p in products],
    }
