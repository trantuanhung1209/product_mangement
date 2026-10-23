from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Product
from app.schemas.product import ProductCreate, ProductPatch, ProductUpdate
from app.services.category import get_category_or_404


def list_products(db: Session) -> list[Product]:
    return list(db.scalars(select(Product).order_by(Product.id)))


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
