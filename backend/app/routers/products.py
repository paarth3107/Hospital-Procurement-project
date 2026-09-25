from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product_master import ProcurementType, ProductCategory, ProductMaster
from app.models.user_account import Role, UserAccount
from app.schemas.product import ProductCreate, ProductOut
from app.services.audit import changed, record, snapshot
from app.security import get_current_user, require_role

PRODUCT_AUDIT_FIELDS = (
    "code", "name", "description", "procurement_type", "category_id", "sub_category", "unit_of_measure", "regulatory_class",
    "approved_brands", "reorder_level", "price_band_min", "price_band_max", "min_mapping_rating", "required_documents",
    "type_specific_attrs", "active",
)

router = APIRouter(prefix="/api/v1/products", tags=["products"])

# Spec §4.1/§4.2 — catalog maintenance sits with Procurement Admin/Category
# Manager, the same two roles that later decide Vendor Mapping requests.
CATALOG_MANAGERS = (Role.PROCUREMENT_ADMIN, Role.CATEGORY_MANAGER, Role.SYSTEM_ADMIN)


def _check_category(payload: ProductCreate, db: Session) -> None:
    category = db.get(ProductCategory, payload.category_id)
    if not category or not category.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    if category.procurement_type != payload.procurement_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Category '{category.name}' is for {category.procurement_type.value}s, not {payload.procurement_type.value}s",
        )


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    existing = db.query(ProductMaster).filter(ProductMaster.code == payload.code).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A catalog entry with this code already exists")

    _check_category(payload, db)
    product = ProductMaster(**payload.model_dump(mode="json"))
    db.add(product)
    db.flush()
    record(db, "product.created", "product", product.id, actor=_user, entity_label=f"{product.code} {product.name}", after=snapshot(product, PRODUCT_AUDIT_FIELDS))
    db.commit()
    db.refresh(product)
    return product


@router.get("", response_model=list[ProductOut])
def list_products(
    procurement_type: ProcurementType | None = None,
    active: bool | None = None,
    db: Session = Depends(get_db),
):
    """Public/unauthenticated on purpose -- ProductOut carries nothing
    sensitive (no vendor data, no pricing), and the vendor-facing mapping
    request page (no vendor login exists yet, same as registration) needs
    to browse the active catalog without a staff token."""
    query = db.query(ProductMaster)
    if procurement_type is not None:
        query = query.filter(ProductMaster.procurement_type == procurement_type)
    if active is not None:
        query = query.filter(ProductMaster.active == active)
    return query.order_by(ProductMaster.code).all()


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    product = db.get(ProductMaster, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    return product


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    """Edit a catalog entry. Its procurement type is fixed once created --
    tender line items copy it, and the type decides the attribute set."""

    product = db.get(ProductMaster, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    if payload.procurement_type != product.procurement_type:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A catalog entry's procurement type can't be changed")
    clash = db.query(ProductMaster).filter(ProductMaster.code == payload.code, ProductMaster.id != product_id).first()
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A catalog entry with this code already exists")
    _check_category(payload, db)
    old = snapshot(product, PRODUCT_AUDIT_FIELDS)
    for field, value in payload.model_dump(mode="json").items():
        setattr(product, field, value)
    before, after = changed(old, snapshot(product, PRODUCT_AUDIT_FIELDS))
    if after:
        record(db, "product.updated", "product", product.id, actor=_user, entity_label=f"{product.code} {product.name}", before=before, after=after)
    db.commit()
    db.refresh(product)
    return product


@router.post("/{product_id}/deactivate", response_model=ProductOut)
def deactivate_product(
    product_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    """Spec §4.2 Active Flag — soft-disable rather than delete; a deactivated
    entry stops appearing for new mapping/tender use but existing mappings
    and tender history referencing it are untouched."""

    product = db.get(ProductMaster, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    product.active = False
    record(db, "product.deactivated", "product", product.id, actor=_user, entity_label=f"{product.code} {product.name}", before={"active": True}, after={"active": False})
    db.commit()
    db.refresh(product)
    return product


@router.post("/{product_id}/activate", response_model=ProductOut)
def activate_product(
    product_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*CATALOG_MANAGERS)),
):
    product = db.get(ProductMaster, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    product.active = True
    record(db, "product.activated", "product", product.id, actor=_user, entity_label=f"{product.code} {product.name}", before={"active": False}, after={"active": True})
    db.commit()
    db.refresh(product)
    return product
