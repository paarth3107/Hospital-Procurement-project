from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product_master import ProductCategory, ProductSubCategory
from app.models.user_account import UserAccount
from app.routers.products import CATALOG_MANAGERS
from app.schemas.product import SubCategoryCreate, SubCategoryOut
from app.services.audit import changed, record, snapshot
from app.security import require_role

SUBCATEGORY_FIELDS = ("name", "category_id")

router = APIRouter(prefix="/api/v1/subcategories", tags=["subcategories"])


@router.get("", response_model=list[SubCategoryOut])
def list_subcategories(category_id: int | None = None, db: Session = Depends(get_db)):
    """Public like /categories and /products, so the mapping matrix's
    Category -> Sub-category drill-down and the vendor-facing catalog browse
    can both use it without a staff token."""
    query = db.query(ProductSubCategory).filter(ProductSubCategory.active.is_(True))
    if category_id is not None:
        query = query.filter(ProductSubCategory.category_id == category_id)
    return query.order_by(ProductSubCategory.category_id, ProductSubCategory.name).all()


@router.post("", response_model=SubCategoryOut, status_code=status.HTTP_201_CREATED)
def create_subcategory(
    payload: SubCategoryCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    category = db.get(ProductCategory, payload.category_id)
    if not category or not category.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    existing = (
        db.query(ProductSubCategory)
        .filter(ProductSubCategory.name.ilike(payload.name), ProductSubCategory.category_id == payload.category_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This sub-category already exists in that category")
    sub_category = ProductSubCategory(name=payload.name, category_id=payload.category_id)
    db.add(sub_category)
    db.flush()
    record(db, "subcategory.created", "subcategory", sub_category.id, actor=_user, entity_label=sub_category.name, after=snapshot(sub_category, SUBCATEGORY_FIELDS))
    db.commit()
    db.refresh(sub_category)
    return sub_category


@router.put("/{subcategory_id}", response_model=SubCategoryOut)
def update_subcategory(
    subcategory_id: int,
    payload: SubCategoryCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    sub_category = db.get(ProductSubCategory, subcategory_id)
    if not sub_category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sub-category not found")
    if payload.category_id != sub_category.category_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A sub-category's parent category can't be changed")
    old = snapshot(sub_category, SUBCATEGORY_FIELDS)
    sub_category.name = payload.name
    before, after = changed(old, snapshot(sub_category, SUBCATEGORY_FIELDS))
    if after:
        record(db, "subcategory.updated", "subcategory", sub_category.id, actor=_user, entity_label=sub_category.name, before=before, after=after)
    db.commit()
    db.refresh(sub_category)
    return sub_category
