from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Response, status
from redis import Redis
from sqlalchemy.orm import Session

from app.core.cache import (
    get_cached_model,
    get_redis,
    invalidate_product_detail_cache,
    invalidate_product_list_cache,
    product_detail_cache_key,
    product_list_cache_key,
    set_cached_model,
)
from app.db.database import get_db
from app.schemas.product import ProductCreate, ProductListResponse, ProductPatch, ProductQuery, ProductResponse, ProductUpdate
from app.services import product as product_service


router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=ProductListResponse)
def list_products(
    query: Annotated[ProductQuery, Query()],
    response: Response,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> ProductListResponse:
    normalized_query = urlencode(query.model_dump(mode="json"))
    cache_key = product_list_cache_key(redis, normalized_query)
    cached = get_cached_model(redis, cache_key, ProductListResponse)
    if cached is not None:
        response.headers["X-Cache"] = "HIT"
        return cached
    result = product_service.list_products(db, query)
    set_cached_model(redis, cache_key, result)
    response.headers["X-Cache"] = "MISS"
    return result


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: int,
    response: Response,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> ProductResponse:
    cache_key = product_detail_cache_key(redis, product_id)
    cached = get_cached_model(redis, cache_key, ProductResponse)
    if cached is not None:
        response.headers["X-Cache"] = "HIT"
        return cached
    result = ProductResponse.model_validate(product_service.get_product_or_404(db, product_id))
    set_cached_model(redis, cache_key, result)
    response.headers["X-Cache"] = "MISS"
    return result


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> ProductResponse:
    product = product_service.create_product(db, payload)
    invalidate_product_list_cache(redis)
    return product


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> ProductResponse:
    product = product_service.update_product(db, product_id, payload, partial=False)
    invalidate_product_list_cache(redis)
    invalidate_product_detail_cache(redis)
    return product


@router.patch("/{product_id}", response_model=ProductResponse)
def patch_product(
    product_id: int,
    payload: ProductPatch,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> ProductResponse:
    product = product_service.update_product(db, product_id, payload, partial=True)
    invalidate_product_list_cache(redis)
    invalidate_product_detail_cache(redis)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> Response:
    product_service.delete_product(db, product_id)
    invalidate_product_list_cache(redis)
    invalidate_product_detail_cache(redis)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
