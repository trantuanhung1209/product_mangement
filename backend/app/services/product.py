from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import asc, desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Product
from app.schemas.product import ProductCreate, ProductListResponse, ProductPatch, ProductQuery, ProductUpdate
from app.services.category import get_category_or_404


SORT_COLUMNS = {
    "id": Product.id,
    "name": Product.name,
    "price": Product.price,
    "stock": Product.stock,
    "created_at": Product.created_at,
}


def list_products(db: Session, query: ProductQuery) -> ProductListResponse:
    filters = []
    if query.search is not None:
        filters.append(Product.name.ilike(f"%{query.search}%"))
    if query.category_id is not None:
        filters.append(Product.category_id == query.category_id)
    if query.min_price is not None:
        filters.append(Product.price >= query.min_price)
    if query.max_price is not None:
        filters.append(Product.price <= query.max_price)

    total = db.scalar(select(func.count()).select_from(Product).where(*filters)) or 0
    order_by = asc if query.order == "asc" else desc
    sort_column = SORT_COLUMNS[query.sort_by]
    ordering = [order_by(sort_column)]
    if query.sort_by != "id":
        ordering.append(order_by(Product.id))
    offset = (query.page - 1) * query.page_size
    products = list(
        db.scalars(select(Product).where(*filters).order_by(*ordering).limit(query.page_size).offset(offset))
    )
    return ProductListResponse(
        items=products,
        total=total,
        page=query.page,
        page_size=query.page_size,
        total_pages=(total + query.page_size - 1) // query.page_size,
    )


def get_product_or_404(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    return product


def product_values(payload: ProductCreate | ProductUpdate | ProductPatch, *, partial: bool) -> dict[str, Any]:
    values = payload.model_dump(exclude_unset=partial)
    if "image_url" in values and values["image_url"] is not None:
        values["image_url"] = str(values["image_url"])
    return values


def create_product(db: Session, payload: ProductCreate) -> Product:
    values = product_values(payload, partial=False)
    get_category_or_404(db, values["category_id"])
    product = Product(**values)
    db.add(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Product could not be saved due to a database constraint.",
        ) from None
    db.refresh(product)
    return product


def update_product(db: Session, product_id: int, payload: ProductUpdate | ProductPatch, *, partial: bool) -> Product:
    product = get_product_or_404(db, product_id)
    values = product_values(payload, partial=partial)
    if "category_id" in values:
        get_category_or_404(db, values["category_id"])
    for field, value in values.items():
        setattr(product, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Product could not be saved due to a database constraint.",
        ) from None
    db.refresh(product)
    return product


def delete_product(db: Session, product_id: int) -> None:
    product = get_product_or_404(db, product_id)
    db.delete(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Product could not be deleted due to a database constraint.",
        ) from None
