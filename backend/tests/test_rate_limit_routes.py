from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Category, Product, UserRole
from test_auth import auth_database_url, auth_engine, auth_redis, client, create_user, csrf_headers, login


def set_limit(monkeypatch: pytest.MonkeyPatch, name: str, value: int) -> None:
    monkeypatch.setenv(name, str(value))
    get_settings.cache_clear()


def assert_limited(response, *, max_retry_after: int = 60) -> None:
    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests. Please try again later."}
    assert 1 <= int(response.headers["retry-after"]) <= max_retry_after


def create_product(engine) -> int:
    with Session(engine) as session:
        category = Category(name=f"rl-{uuid4().hex}")
        session.add(category)
        session.flush()
        product = Product(name="rl-product", price=1, stock=1, category_id=category.id)
        session.add(product)
        session.commit()
        return product.id


@pytest.mark.database
def test_refresh_limit_returns_429_with_retry_after(client: TestClient, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch) -> None:
    set_limit(monkeypatch, "RATE_LIMIT_REFRESH_PER_MINUTE", 2)

    assert [client.post("/api/v1/auth/refresh").status_code for _ in range(2)] == [401, 401]
    assert_limited(client.post("/api/v1/auth/refresh"))
    get_settings.cache_clear()


@pytest.mark.database
def test_image_upload_limit_returns_429_with_retry_after_per_user(
    client: TestClient, auth_engine, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_limit(monkeypatch, "RATE_LIMIT_IMAGE_UPLOAD_PER_MINUTE", 1)
    product_id = create_product(auth_engine)
    endpoint = f"/api/v1/products/{product_id}/image"
    upload = lambda test_client: test_client.post(
        endpoint, headers=csrf_headers(test_client), files={"file": ("x.jpg", b"not-an-image", "image/jpeg")}
    )
    email, password = create_user(auth_engine, role=UserRole.ADMIN)
    login(client, email, password)

    assert upload(client).status_code == 422  # reaches validation, so it consumed the single allowed request
    assert_limited(upload(client))

    with TestClient(client.app) as other_client:
        other_email, other_password = create_user(auth_engine, role=UserRole.ADMIN)
        login(other_client, other_email, other_password)
        assert upload(other_client).status_code == 422  # another admin has an independent budget
    get_settings.cache_clear()


@pytest.mark.database
def test_search_limit_returns_retry_after_is_shared_with_cursor_endpoint_and_ignores_plain_listing(
    client: TestClient, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_limit(monkeypatch, "RATE_LIMIT_PUBLIC_SEARCH_PER_MINUTE", 1)

    assert all(client.get("/api/v1/products").status_code == 200 for _ in range(5))  # no search term: never limited
    assert client.get("/api/v1/products?search=abc").status_code == 200
    assert_limited(client.get("/api/v1/products?search=abc"))
    assert_limited(client.get("/api/v1/products/cursor?search=abc"))
    assert client.get("/api/v1/products").status_code == 200
    get_settings.cache_clear()


@pytest.mark.database
def test_session_operation_limit_covers_logout_and_revoke_access(
    client: TestClient, auth_engine, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_limit(monkeypatch, "RATE_LIMIT_SESSION_PER_MINUTE", 0)
    email, password = create_user(auth_engine)
    login(client, email, password)

    assert_limited(client.post("/api/v1/auth/logout", headers=csrf_headers(client)))
    assert_limited(client.post("/api/v1/auth/revoke-access", headers=csrf_headers(client)))
    set_limit(monkeypatch, "RATE_LIMIT_SESSION_PER_MINUTE", 10)
    assert client.get("/api/v1/auth/me").status_code == 200  # a limited request must not revoke anything
    assert client.post("/api/v1/auth/logout", headers=csrf_headers(client)).status_code == 204


@pytest.mark.database
def test_login_limit_is_per_ip_and_per_account(
    client: TestClient, auth_engine, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_limit(monkeypatch, "RATE_LIMIT_LOGIN_PER_MINUTE", 3)
    first, _ = create_user(auth_engine)
    second, _ = create_user(auth_engine)

    for _ in range(3):
        assert client.post("/api/v1/auth/login", json={"email": first, "password": "wrong"}).status_code == 401
    assert_limited(client.post("/api/v1/auth/login", json={"email": first.upper(), "password": "wrong"}))  # email is normalized
    assert_limited(client.post("/api/v1/auth/login", json={"email": second, "password": "wrong"}))  # the IP budget is spent too
    get_settings.cache_clear()


@pytest.mark.database
@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/sessions/does-not-exist",
        "/api/v1/auth/sessions/others",
        "/api/v1/admin/users/1/sessions/abc",
        "/api/v1/admin/users/1/sessions",
    ],
)
def test_session_revocation_endpoints_are_rate_limited_per_user(
    path: str, client: TestClient, auth_engine, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    set_limit(monkeypatch, "RATE_LIMIT_MUTATION_PER_MINUTE", 1)
    email, password = create_user(auth_engine, role=UserRole.ADMIN)
    login(client, email, password)

    assert client.delete(path, headers=csrf_headers(client)).status_code != 429
    assert_limited(client.delete(path, headers=csrf_headers(client)))
    get_settings.cache_clear()
