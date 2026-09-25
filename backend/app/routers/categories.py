from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product_master import ProcurementType, ProductCategory
from app.models.user_account import UserAccount
from app.routers.products import CATALOG_MANAGERS
from app.schemas.product import CategoryCreate, CategoryOut
from app.services.audit import changed, record, snapshot
from app.security import require_role

CATEGORY_FIELDS = ("name", "procurement_type", "min_mapping_rating", "required_documents")

router = APIRouter(prefix="/api/v1/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(procurement_type: ProcurementType | None = None, db: Session = Depends(get_db)):
    """Public like the catalog listing (nothing sensitive), so the vendor's
    Categories tab can browse it."""
    query = db.query(ProductCategory).filter(ProductCategory.active.is_(True))
    if procurement_type is not None:
        query = query.filter(ProductCategory.procurement_type == procurement_type)
    return query.order_by(ProductCategory.procurement_type, ProductCategory.name).all()


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    existing = (
        db.query(ProductCategory)
        .filter(ProductCategory.name.ilike(payload.name), ProductCategory.procurement_type == payload.procurement_type)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This category already exists for that type")
    category = ProductCategory(**payload.model_dump(mode="json"))
    db.add(category)
    db.flush()
    record(db, "category.created", "category", category.id, actor=_user, entity_label=category.name, after=snapshot(category, CATEGORY_FIELDS))
    db.commit()
    db.refresh(category)
    return category


@router.put("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    category = db.get(ProductCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    if payload.procurement_type != category.procurement_type:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A category's procurement type can't be changed")
    old = snapshot(category, CATEGORY_FIELDS)
    category.name = payload.name
    category.min_mapping_rating = payload.min_mapping_rating
    category.required_documents = payload.required_documents
    before, after = changed(old, snapshot(category, CATEGORY_FIELDS))
    if after:
        record(db, "category.updated", "category", category.id, actor=_user, entity_label=category.name, before=before, after=after)
    db.commit()
    db.refresh(category)
    return category
