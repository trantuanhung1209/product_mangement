from collections.abc import Generator
import os
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from redis import Redis
from redis.exceptions import ConnectionError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.cache import get_redis, product_list_cache_key
from app.db.database import get_db
from app.main import create_app
from app.schemas.product import ProductQuery


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_URL = "/api/v1/products"
CATEGORIES_URL = "/api/v1/categories"


@pytest.fixture(scope="session")
def cache_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if url is None:
        pytest.skip("TEST_DATABASE_URL is required for cache integration tests.")
    return url


@pytest.fixture(scope="session")
def cache_engine(cache_database_url: str):
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", cache_database_url)
    command.upgrade(alembic_config, "head")
    engine = create_engine(cache_database_url, pool_size=2, max_overflow=0)
    yield engine
    engine.dispose()


@pytest.fixture
def cache_redis() -> Generator[Redis, None, None]:
    url = os.getenv("TEST_REDIS_URL")
    if url is None:
        pytest.skip("TEST_REDIS_URL is required for cache integration tests.")
    redis = Redis.from_url(url, decode_responses=True)
    try:
        redis.ping()
    except ConnectionError:
        pytest.skip("TEST_REDIS_URL is unavailable for cache integration tests.")
    redis.flushdb()
    yield redis
    redis.flushdb()
    redis.close()


@pytest.fixture
def client(cache_engine, cache_redis: Redis) -> Generator[TestClient, None, None]:
    app = create_app()

    def override_get_db() -> Generator[Session, None, None]:
        session = Session(cache_engine)
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_redis] = lambda: cache_redis
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def unique_prefix() -> str:
    return f"cache-{uuid4().hex}"


def create_category(client: TestClient, prefix: str) -> int:
    response = client.post(CATEGORIES_URL, json={"name": f"{prefix}-category"})
    assert response.status_code == 201
    return response.json()["id"]


def create_product(client: TestClient, name: str, category_id: int, *, stock: int = 1) -> dict:
    response = client.post(
        PRODUCTS_URL,
        json={"name": name, "price": "10.00", "stock": stock, "category_id": category_id},
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.database
def test_list_cache_hit_ttl_and_normalized_query_key(client: TestClient, cache_redis: Redis) -> None:
    prefix = unique_prefix()
    category_id = create_category(client, prefix)
    create_product(client, f"{prefix}-Keyboard", category_id)

    first = client.get(PRODUCTS_URL, params={"search": f"  {prefix}  "})
    second = client.get(PRODUCTS_URL, params={"search": prefix})
    different_page = client.get(PRODUCTS_URL, params={"search": prefix, "page": 2})

    assert first.headers["x-cache"] == "MISS"
    assert second.headers["x-cache"] == "HIT"
    assert second.json() == first.json()
    assert different_page.headers["x-cache"] == "MISS"
    normalized_query = urlencode(ProductQuery(search=prefix).model_dump(mode="json"))
    cache_key = product_list_cache_key(cache_redis, normalized_query)
    assert cache_key is not None
    assert 0 < cache_redis.ttl(cache_key) <= 60


@pytest.mark.database
def test_detail_cache_and_mutations_invalidate_after_success(client: TestClient) -> None:
    prefix = unique_prefix()
    category_id = create_category(client, prefix)
    product = create_product(client, f"{prefix}-Keyboard", category_id)

    cached_list = client.get(PRODUCTS_URL, params={"search": prefix})
    first_detail = client.get(f"{PRODUCTS_URL}/{product['id']}")
    second_detail = client.get(f"{PRODUCTS_URL}/{product['id']}")
    assert cached_list.headers["x-cache"] == "MISS"
    assert first_detail.headers["x-cache"] == "MISS"
    assert second_detail.headers["x-cache"] == "HIT"

    updated = client.patch(f"{PRODUCTS_URL}/{product['id']}", json={"stock": 9})
    list_after_update = client.get(PRODUCTS_URL, params={"search": prefix})
    detail_after_update = client.get(f"{PRODUCTS_URL}/{product['id']}")
    assert updated.status_code == 200
    assert list_after_update.headers["x-cache"] == "MISS"
    assert detail_after_update.headers["x-cache"] == "MISS"
    assert detail_after_update.json()["stock"] == 9

    deleted = client.delete(f"{PRODUCTS_URL}/{product['id']}")
    list_after_delete = client.get(PRODUCTS_URL, params={"search": prefix})
    assert deleted.status_code == 204
    assert list_after_delete.headers["x-cache"] == "MISS"
    assert list_after_delete.json()["total"] == 0


@pytest.mark.database
def test_create_invalidates_a_cached_list(client: TestClient) -> None:
    prefix = unique_prefix()
    category_id = create_category(client, prefix)
    empty = client.get(PRODUCTS_URL, params={"search": prefix})
    create_product(client, f"{prefix}-Keyboard", category_id)
    after_create = client.get(PRODUCTS_URL, params={"search": prefix})

    assert empty.headers["x-cache"] == "MISS"
    assert empty.json()["total"] == 0
    assert after_create.headers["x-cache"] == "MISS"
    assert after_create.json()["total"] == 1


@pytest.mark.database
def test_failed_product_mutation_keeps_cached_list(client: TestClient) -> None:
    prefix = unique_prefix()
    first = client.get(PRODUCTS_URL, params={"search": prefix})
    failed = client.post(
        PRODUCTS_URL,
        json={"name": f"{prefix}-Keyboard", "price": "10.00", "stock": 1, "category_id": 999999999},
    )
    after_failure = client.get(PRODUCTS_URL, params={"search": prefix})

    assert first.headers["x-cache"] == "MISS"
    assert failed.status_code == 404
    assert after_failure.headers["x-cache"] == "HIT"


class UnavailableRedis:
    def setnx(self, *_args: object) -> None:
        raise ConnectionError("Redis is unavailable")


@pytest.mark.database
def test_redis_unavailable_falls_back_to_database(client: TestClient) -> None:
    prefix = unique_prefix()
    category_id = create_category(client, prefix)
    create_product(client, f"{prefix}-Keyboard", category_id)
    client.app.dependency_overrides[get_redis] = UnavailableRedis

    response = client.get(PRODUCTS_URL, params={"search": prefix})

    assert response.status_code == 200
    assert response.headers["x-cache"] == "MISS"
    assert response.json()["total"] == 1
