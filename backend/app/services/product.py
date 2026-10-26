import base64
import binascii
import hashlib
import hmac
import json
from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import asc, desc, func, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import ImageCleanupTask, Product
from app.core.config import get_settings
from app.schemas.product import (
    ProductCreate,
    ProductCursorQuery,
    ProductCursorResponse,
    ProductListResponse,
    ProductPatch,
    ProductQuery,
    ProductResponse,
    ProductUpdate,
)
from app.services.category import get_category_or_404


SORT_COLUMNS = {
    "id": Product.id,
    "name": Product.name,
    "price": Product.price,
    "stock": Product.stock,
    "created_at": Product.created_at,
}
CURSOR_VERSION = 1


def product_filters(query: ProductQuery | ProductCursorQuery) -> list[Any]:
    filters = []
    if query.search is not None:
        filters.append(Product.name.ilike(f"%{query.search}%"))
    if query.category_id is not None:
        filters.append(Product.category_id == query.category_id)
    if query.min_price is not None:
        filters.append(Product.price >= query.min_price)
    if query.max_price is not None:
        filters.append(Product.price <= query.max_price)
    return filters


def list_products(db: Session, query: ProductQuery) -> ProductListResponse:
    filters = product_filters(query)

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


def _cursor_error(detail: str = "Invalid cursor.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _cursor_secret() -> bytes:
    secret = get_settings().product_cursor_hmac_key
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Cursor service unavailable.")
    return secret.encode()


def _base64_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _base64_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _decimal_value(value: Decimal | None) -> str | None:
    if value is None:
        return None
    normalized = format(value, "f").rstrip("0").rstrip(".")
    return normalized or "0"


def _filter_fingerprint(query: ProductCursorQuery) -> str:
    filters = {
        "category_id": query.category_id,
        "max_price": _decimal_value(query.max_price),
        "min_price": _decimal_value(query.min_price),
        "search": query.search,
    }
    encoded = json.dumps(filters, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def encode_product_cursor(product: Product, query: ProductCursorQuery) -> str:
    payload = json.dumps(
        {
            "created_at": product.created_at.isoformat(),
            "f": _filter_fingerprint(query),
            "id": product.id,
            "v": CURSOR_VERSION,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    signature = hmac.new(_cursor_secret(), payload, hashlib.sha256).digest()
    return f"{_base64_encode(payload)}.{_base64_encode(signature)}"


def decode_product_cursor(cursor: str, query: ProductCursorQuery) -> tuple[datetime, int]:
    try:
        encoded_payload, encoded_signature = cursor.split(".", 1)
        payload = _base64_decode(encoded_payload)
        signature = _base64_decode(encoded_signature)
        expected_signature = hmac.new(_cursor_secret(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError
        values = json.loads(payload)
        if values.get("v") != CURSOR_VERSION:
            raise _cursor_error("Unsupported cursor version.")
        created_at = datetime.fromisoformat(values["created_at"])
        product_id = values["id"]
        fingerprint = values["f"]
        if (
            created_at.tzinfo is None
            or not isinstance(product_id, int)
            or isinstance(product_id, bool)
            or product_id <= 0
            or not isinstance(fingerprint, str)
            or not hmac.compare_digest(fingerprint, _filter_fingerprint(query))
        ):
            raise ValueError
    except HTTPException:
        raise
    except (AttributeError, KeyError, TypeError, ValueError, binascii.Error, json.JSONDecodeError):
        raise _cursor_error() from None
    return created_at, product_id


def list_products_by_cursor(db: Session, query: ProductCursorQuery) -> ProductCursorResponse:
    filters = product_filters(query)
    if query.cursor is not None:
        created_at, product_id = decode_product_cursor(query.cursor, query)
        filters.append(tuple_(Product.created_at, Product.id) < tuple_(created_at, product_id))
    products = list(
        db.scalars(
            select(Product)
            .where(*filters)
            .order_by(desc(Product.created_at), desc(Product.id))
            .limit(query.limit + 1)
        )
    )
    has_more = len(products) > query.limit
    items = products[:query.limit]
    return ProductCursorResponse(
        items=[ProductResponse.model_validate(product) for product in items],
        has_more=has_more,
        next_cursor=encode_product_cursor(items[-1], query) if has_more else None,
    )


def get_product_or_404(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    return product


def get_product_for_update_or_404(db: Session, product_id: int) -> Product:
    product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
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
    if product.image_object_key:
        values.pop("image_url", None)
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


def delete_product(db: Session, product_id: int) -> str | None:
    product = get_product_for_update_or_404(db, product_id)
    old_key = product.image_object_key
    if old_key:
        db.add(ImageCleanupTask(object_key=old_key))
    db.delete(product)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Product could not be deleted due to a database constraint.",
        ) from None
    return old_key
