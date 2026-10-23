import logging
from typing import TypeVar

from fastapi import Request
from pydantic import BaseModel, ValidationError
from redis import Redis
from redis.exceptions import RedisError


logger = logging.getLogger("app.cache")
CACHE_TTL_SECONDS = 60
CACHE_NAMESPACE = "product-catalog"
LIST_VERSION_KEY = f"{CACHE_NAMESPACE}:products:list:version"
DETAIL_VERSION_KEY = f"{CACHE_NAMESPACE}:products:detail:version"
T = TypeVar("T", bound=BaseModel)


def get_redis(request: Request) -> Redis | None:
    return request.app.state.redis


def _version(redis: Redis | None, version_key: str) -> int | None:
    if redis is None:
        return None
    try:
        redis.setnx(version_key, 0)
        value = redis.get(version_key)
        return int(value) if value is not None else 0
    except (RedisError, ValueError) as error:
        logger.warning("Redis unavailable; using database fallback (%s)", type(error).__name__)
        return None


def product_list_cache_key(redis: Redis | None, normalized_query: str) -> str | None:
    version = _version(redis, LIST_VERSION_KEY)
    if version is None:
        return None
    return f"{CACHE_NAMESPACE}:products:list:v{version}:{normalized_query}"


def product_detail_cache_key(redis: Redis | None, product_id: int) -> str | None:
    version = _version(redis, DETAIL_VERSION_KEY)
    if version is None:
        return None
    return f"{CACHE_NAMESPACE}:products:detail:v{version}:{product_id}"


def get_cached_model(redis: Redis | None, key: str | None, model: type[T]) -> T | None:
    if redis is None or key is None:
        return None
    try:
        payload = redis.get(key)
    except RedisError as error:
        logger.warning("Redis unavailable; using database fallback (%s)", type(error).__name__)
        return None
    if payload is None:
        logger.info("Cache miss")
        return None
    try:
        response = model.model_validate_json(payload)
    except ValidationError:
        logger.warning("Cached response was invalid; using database fallback")
        try:
            redis.delete(key)
        except RedisError:
            pass
        return None
    logger.info("Cache hit")
    return response


def set_cached_model(redis: Redis | None, key: str | None, response: BaseModel) -> None:
    if redis is None or key is None:
        return
    try:
        redis.set(key, response.model_dump_json(), ex=CACHE_TTL_SECONDS)
    except RedisError as error:
        logger.warning("Redis unavailable; response was not cached (%s)", type(error).__name__)


def invalidate_product_list_cache(redis: Redis | None) -> None:
    _increment_version(redis, LIST_VERSION_KEY)


def invalidate_product_detail_cache(redis: Redis | None) -> None:
    _increment_version(redis, DETAIL_VERSION_KEY)


def _increment_version(redis: Redis | None, version_key: str) -> None:
    if redis is None:
        return
    try:
        redis.incr(version_key)
    except RedisError as error:
        logger.warning("Redis unavailable; cache was not invalidated (%s)", type(error).__name__)
