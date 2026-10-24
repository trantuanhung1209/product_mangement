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
from app.core.security import require_admin_with_csrf
from app.main import create_app


BACKEND_ROOT = Path(__file__).resolve().parents[1]
API_PREFIX = "/api/v1"


@pytest.fixture(scope="session")
def api_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if url is None:
        pytest.skip("TEST_DATABASE_URL is required for API integration tests.")
    return url


@pytest.fixture(scope="session")
def api_engine(api_database_url: str):
    alembic_config = Config(str(BACKEND_ROOT / "alembic.ini"))
    alembic_config.set_main_option("sqlalchemy.url", api_database_url)
    command.upgrade(alembic_config, "head")
    engine = create_engine(api_database_url, pool_size=2, max_overflow=0)
    yield engine
    engine.dispose()


@pytest.fixture
def client(api_engine) -> Generator[TestClient, None, None]:
    app = create_app()

    def override_get_db() -> Generator[Session, None, None]:
        session = Session(api_engine)
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_admin_with_csrf] = lambda: None
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def unique_name(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex}"


def create_category(client: TestClient, name: str | None = None) -> dict[str, object]:
    response = client.post(
        f"{API_PREFIX}/categories",
        json={"name": name or unique_name("category"), "description": "A category"},
    )
    assert response.status_code == 201
    return response.json()


def create_product(client: TestClient, category_id: int) -> dict[str, object]:
    response = client.post(
        f"{API_PREFIX}/products",
        json={
            "name": "  Keyboard  ",
            "description": "Mechanical",
            "price": "19.99",
            "stock": 3,
            "category_id": category_id,
            "image_url": "https://example.com/keyboard.png",
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.database
def test_category_crud_and_prefix(client: TestClient) -> None:
    name = unique_name("category")
    created = create_category(client, f"  {name}  ")

    assert created["name"] == name
    listed = client.get(f"{API_PREFIX}/categories")
    assert listed.status_code == 200
    assert any(category["id"] == created["id"] for category in listed.json())
    assert client.get("/categories").status_code == 404

    updated = client.put(
        f"{API_PREFIX}/categories/{created['id']}",
        json={"name": f"{name}-updated", "description": None},
    )
    assert updated.status_code == 200
    assert updated.json()["description"] is None

    deleted = client.delete(f"{API_PREFIX}/categories/{created['id']}")
    assert deleted.status_code == 204
    assert deleted.content == b""


@pytest.mark.database
def test_category_duplicate_returns_json_409_and_rolls_back(client: TestClient) -> None:
    name = unique_name("category")
    create_category(client, name)

    duplicate = client.post(f"{API_PREFIX}/categories", json={"name": name})
    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "Category name already exists."}

    listed = client.get(f"{API_PREFIX}/categories")
    assert sum(category["name"] == name for category in listed.json()) == 1


@pytest.mark.database
def test_product_crud_put_and_patch(client: TestClient) -> None:
    category = create_category(client)
    product = create_product(client, category["id"])

    assert product["name"] == "Keyboard"
    assert product["price"] == "19.99"
    fetched = client.get(f"{API_PREFIX}/products/{product['id']}")
    assert fetched.status_code == 200

    legacy_marker = "Mechanical \u2063product-catalog-seed:phase-07\u2063:1:2"
    legacy_response = client.patch(f"{API_PREFIX}/products/{product['id']}", json={"description": legacy_marker})
    assert legacy_response.status_code == 200
    assert legacy_response.json()["description"] == "Mechanical"

    put_response = client.put(
        f"{API_PREFIX}/products/{product['id']}",
        json={
            "name": "Mouse",
            "description": None,
            "price": "20.00",
            "stock": 4,
            "category_id": category["id"],
            "image_url": None,
        },
    )
    assert put_response.status_code == 200
    assert put_response.json()["name"] == "Mouse"
    assert put_response.json()["image_url"] is None

    patch_response = client.patch(f"{API_PREFIX}/products/{product['id']}", json={"stock": 8})
    assert patch_response.status_code == 200
    assert patch_response.json()["stock"] == 8
    assert patch_response.json()["name"] == "Mouse"

    deleted = client.delete(f"{API_PREFIX}/products/{product['id']}")
    assert deleted.status_code == 204
    assert deleted.content == b""


@pytest.mark.database
def test_product_validation_and_put_contract_return_422(client: TestClient) -> None:
    category = create_category(client)
    product = create_product(client, category["id"])

    invalid = client.post(
        f"{API_PREFIX}/products",
        json={"name": "   ", "price": 0, "stock": -1, "category_id": category["id"], "image_url": "bad"},
    )
    assert invalid.status_code == 422
    assert isinstance(invalid.json()["detail"], list)

    incomplete_put = client.put(f"{API_PREFIX}/products/{product['id']}", json={"name": "Only name"})
    assert incomplete_put.status_code == 422


@pytest.mark.database
def test_invalid_category_not_found_and_category_fk_conflict(client: TestClient) -> None:
    missing_category = client.post(
        f"{API_PREFIX}/products",
        json={"name": "Keyboard", "price": "1.00", "stock": 1, "category_id": 999999999},
    )
    assert missing_category.status_code == 404
    assert missing_category.json() == {"detail": "Category not found."}

    category = create_category(client)
    product = create_product(client, category["id"])
    conflict = client.delete(f"{API_PREFIX}/categories/{category['id']}")
    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "Category cannot be deleted while it has products."}

    assert client.get(f"{API_PREFIX}/products/999999999").status_code == 404
    assert client.delete(f"{API_PREFIX}/products/{product['id']}").status_code == 204
    assert client.delete(f"{API_PREFIX}/categories/{category['id']}").status_code == 204


@pytest.mark.database
def test_patch_can_clear_optional_fields(client: TestClient) -> None:
    category = create_category(client)
    product = create_product(client, category["id"])

    patched = client.patch(
        f"{API_PREFIX}/products/{product['id']}",
        json={"description": None, "image_url": None},
    )
    assert patched.status_code == 200
    assert patched.json()["description"] is None
    assert patched.json()["image_url"] is None
