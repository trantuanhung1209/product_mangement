import pytest
from fastapi.testclient import TestClient

from app.models import UserRole
from test_auth import (
    CSRF_HEADER,
    auth_database_url,
    auth_engine,
    auth_redis,
    client,
    create_user,
    csrf_headers,
    login,
)

# Every non-public API route must appear in exactly one group, so a new route cannot
# silently skip the access-control checks below (see test_every_route_is_classified).
ADMIN_ONLY = [
    ("GET", "/api/v1/admin/users"),
    ("GET", "/api/v1/admin/users/{user_id}/sessions"),
    ("DELETE", "/api/v1/admin/users/{user_id}/sessions"),
    ("DELETE", "/api/v1/admin/users/{user_id}/sessions/{session_id}"),
    ("POST", "/api/v1/categories"),
    ("PUT", "/api/v1/categories/{category_id}"),
    ("DELETE", "/api/v1/categories/{category_id}"),
    ("POST", "/api/v1/products"),
    ("PUT", "/api/v1/products/{product_id}"),
    ("PATCH", "/api/v1/products/{product_id}"),
    ("DELETE", "/api/v1/products/{product_id}"),
    ("POST", "/api/v1/products/{product_id}/image"),
    ("DELETE", "/api/v1/products/{product_id}/image"),
]
LOGIN_REQUIRED = [
    ("GET", "/api/v1/auth/me"),
    ("POST", "/api/v1/auth/logout"),
    ("POST", "/api/v1/auth/revoke-access"),
    ("POST", "/api/v1/auth/password/change"),
    ("GET", "/api/v1/auth/sessions"),
    ("DELETE", "/api/v1/auth/sessions/others"),
    ("DELETE", "/api/v1/auth/sessions/{session_id}"),
    ("GET", "/api/v1/cart"),
    ("DELETE", "/api/v1/cart"),
    ("POST", "/api/v1/cart/items"),
    ("PATCH", "/api/v1/cart/items/{product_id}"),
    ("DELETE", "/api/v1/cart/items/{product_id}"),
]
PUBLIC = [
    ("GET", "/health"),
    ("POST", "/api/v1/auth/login"),
    # Sign-up is public by design; each route is Origin-checked and rate limited.
    ("POST", "/api/v1/auth/register/request-otp"),
    ("POST", "/api/v1/auth/register/resend-otp"),
    ("POST", "/api/v1/auth/register/verify-otp"),
    # Password recovery runs before any session exists: Origin-checked and rate limited.
    ("POST", "/api/v1/auth/password/forgot"),
    ("POST", "/api/v1/auth/password/reset"),
    ("POST", "/api/v1/auth/refresh"),  # authenticated by the refresh cookie, not the access cookie
    ("GET", "/api/v1/categories"),
    ("GET", "/api/v1/products"),
    ("GET", "/api/v1/products/cursor"),
    ("GET", "/api/v1/products/{product_id}"),
    ("GET", "/api/v1/products/{product_id}/image"),
]


SAMPLE_VALUES = {"user_id": "1", "session_id": "abc", "category_id": "1", "product_id": "1"}


def call(test_client: TestClient, method: str, path: str, headers: dict[str, str] | None = None):
    return test_client.request(method, path.format(**SAMPLE_VALUES), headers=headers or {})


@pytest.mark.database
def test_every_route_is_classified(client: TestClient) -> None:
    documented = {
        (method.upper(), path)
        for path, operations in client.app.openapi()["paths"].items()
        for method in operations
    }
    classified = set(ADMIN_ONLY) | set(LOGIN_REQUIRED) | set(PUBLIC)
    assert documented - classified == set(), "routes missing from the access-control matrix"
    assert classified - documented == set(), "matrix lists routes that no longer exist"


@pytest.mark.database
def test_anonymous_is_rejected_with_401_on_every_protected_route(client: TestClient) -> None:
    failures = {}
    for method, path in ADMIN_ONLY + LOGIN_REQUIRED:
        status = call(client, method, path).status_code
        if status != 401:
            failures[f"{method} {path}"] = status
    assert not failures, failures


@pytest.mark.database
def test_regular_user_gets_403_on_every_admin_route_and_never_reaches_validation(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine, role=UserRole.USER)
    login(client, email, password)
    failures = {}
    for method, path in ADMIN_ONLY:
        response = call(client, method, path, csrf_headers(client))
        if response.status_code != 403 or response.json() != {"detail": "Admin role required."}:
            failures[f"{method} {path}"] = (response.status_code, response.text[:120])
    assert not failures, failures


@pytest.mark.database
def test_admin_without_csrf_header_is_rejected_on_every_state_changing_admin_route(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine, role=UserRole.ADMIN)
    login(client, email, password)
    failures = {}
    for method, path in ADMIN_ONLY:
        if method == "GET":
            continue
        status = call(client, method, path).status_code
        wrong = call(client, method, path, {CSRF_HEADER: "not-the-csrf-token"}).status_code
        if (status, wrong) != (403, 403):
            failures[f"{method} {path}"] = (status, wrong)
    assert not failures, failures


@pytest.mark.database
def test_cart_mutations_require_csrf_for_a_logged_in_user(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    login(client, email, password)
    failures = {}
    for method, path in [(m, p) for m, p in LOGIN_REQUIRED if p.startswith("/api/v1/cart") and m != "GET"]:
        status = call(client, method, path).status_code
        if status != 403:
            failures[f"{method} {path}"] = status
    assert not failures, failures
