from collections.abc import Generator
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.main import create_app


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_URL = "/api/v1/products"
CATEGORIES_URL = "/api/v1/categories"


@pytest.fixture(scope="session")
def query_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if url is None:
        pytest.skip("TEST_DATABASE_URL is required for product query integration tests.")
    return url


@pytest.fixture(scope="session")
def query_engine(query_database_url: str):
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", query_database_url)
    command.upgrade(alembic_config, "head")
    engine = create_engine(query_database_url, pool_size=2, max_overflow=0)
    yield engine
    engine.dispose()


@pytest.fixture
def client(query_engine) -> Generator[TestClient, None, None]:
    app = create_app()

    def override_get_db() -> Generator[Session, None, None]:
        session = Session(query_engine)
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def unique_prefix() -> str:
    return f"query-{uuid4().hex}"


def create_category(client: TestClient, prefix: str) -> int:
    response = client.post(CATEGORIES_URL, json={"name": f"{prefix}-category"})
    assert response.status_code == 201
    return response.json()["id"]


def create_product(client: TestClient, name: str, category_id: int, *, price: str = "10.00", stock: int = 1) -> dict:
    response = client.post(
        PRODUCTS_URL,
        json={"name": name, "price": price, "stock": stock, "category_id": category_id},
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.database
def test_default_pagination_metadata_and_out_of_range_page(client: TestClient) -> None:
    prefix = unique_prefix()
    category_id = create_category(client, prefix)
    created = [create_product(client, f"{prefix}-{index}", category_id) for index in range(11)]

    first_page = client.get(PRODUCTS_URL, params={"search": prefix})
    assert first_page.status_code == 200
    assert first_page.json()["total"] == 11
    assert first_page.json()["page"] == 1
    assert first_page.json()["page_size"] == 10
    assert first_page.json()["total_pages"] == 2
    assert len(first_page.json()["items"]) == 10
    assert first_page.json()["items"][0]["id"] == created[-1]["id"]

    out_of_range = client.get(PRODUCTS_URL, params={"search": prefix, "page": 3})
    assert out_of_range.status_code == 200
    assert out_of_range.json() == {"items": [], "total": 11, "page": 3, "page_size": 10, "total_pages": 2}


@pytest.mark.database
def test_query_validation_and_page_size_maximum(client: TestClient) -> None:
    assert client.get(PRODUCTS_URL, params={"page": 0}).status_code == 422
    assert client.get(PRODUCTS_URL, params={"page_size": 101}).status_code == 422
    assert client.get(PRODUCTS_URL, params={"min_price": "20", "max_price": "10"}).status_code == 422
    assert client.get(PRODUCTS_URL, params={"sort_by": "description"}).status_code == 422

    max_page_size = client.get(PRODUCTS_URL, params={"page_size": 100})
    assert max_page_size.status_code == 200
    assert max_page_size.json()["page_size"] == 100


@pytest.mark.database
def test_case_insensitive_search_category_and_price_filters(client: TestClient) -> None:
    prefix = unique_prefix()
    first_category = create_category(client, f"{prefix}-first")
    second_category = create_category(client, f"{prefix}-second")
    matched = create_product(client, f"{prefix}-Phone", first_category, price="25.00")
    create_product(client, f"{prefix}-Phone-budget", first_category, price="5.00")
    create_product(client, f"{prefix}-Phone", second_category, price="30.00")

    response = client.get(
        PRODUCTS_URL,
        params={
            "search": f"{prefix.lower()}-phone",
            "category_id": first_category,
            "min_price": "20.00",
            "max_price": "30.00",
        },
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == matched["id"]


@pytest.mark.database
def test_sorting_is_stable_with_id_tie_breaker(client: TestClient) -> None:
    prefix = unique_prefix()
    category_id = create_category(client, prefix)
    first = create_product(client, f"{prefix}-first", category_id, stock=5)
    second = create_product(client, f"{prefix}-second", category_id, stock=5)
    lowest = create_product(client, f"{prefix}-lowest", category_id, stock=1)

    ascending = client.get(PRODUCTS_URL, params={"search": prefix, "sort_by": "stock", "order": "asc"})
    descending = client.get(PRODUCTS_URL, params={"search": prefix, "sort_by": "stock", "order": "desc"})

    assert [item["id"] for item in ascending.json()["items"]] == [lowest["id"], first["id"], second["id"]]
    assert [item["id"] for item in descending.json()["items"]] == [second["id"], first["id"], lowest["id"]]


@pytest.mark.database
def test_empty_result_has_zero_total_pages(client: TestClient) -> None:
    response = client.get(PRODUCTS_URL, params={"search": unique_prefix()})

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 10, "total_pages": 0}
