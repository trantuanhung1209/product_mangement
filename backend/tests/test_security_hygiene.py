import logging

import pytest
from fastapi.testclient import TestClient
from redis import Redis

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_COOKIE, CSRF_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE
from app.db.database import get_db
from test_auth import auth_database_url, auth_engine, auth_redis, client, create_user, csrf_headers, login

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
}


@pytest.mark.database
def test_security_headers_are_present_on_success_and_error_responses(client: TestClient) -> None:
    responses = {
        "200": client.get("/health"),
        "401": client.get("/api/v1/auth/me"),
        "404": client.get("/api/v1/products/999999999"),
        "404-route": client.get("/no/such/route"),
        "405": client.delete("/health"),
        "422": client.get("/api/v1/products", params={"page": 0}),
    }
    for name, response in responses.items():
        for header, value in SECURITY_HEADERS.items():
            assert response.headers.get(header) == value, (name, header)
        assert "strict-transport-security" not in response.headers, name  # HSTS is opt-in


@pytest.mark.database
def test_hsts_is_added_only_when_enabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECURITY_HSTS_ENABLED", "true")
    get_settings.cache_clear()
    for response in (client.get("/health"), client.get("/api/v1/auth/me")):
        assert response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
    get_settings.cache_clear()


@pytest.mark.database
def test_forwarded_for_from_an_untrusted_peer_cannot_change_the_rate_limit_identity(
    client: TestClient, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RATE_LIMIT_PUBLIC_SEARCH_PER_MINUTE", "1")
    monkeypatch.setenv("TRUSTED_PROXY_IPS", '["10.9.8.7"]')  # the test peer is "testclient", not this proxy
    get_settings.cache_clear()
    assert client.get("/api/v1/products?search=a", headers={"X-Forwarded-For": "198.51.100.1"}).status_code == 200
    assert client.get("/api/v1/products?search=a", headers={"X-Forwarded-For": "198.51.100.2"}).status_code == 429
    get_settings.cache_clear()


@pytest.mark.database
def test_unhandled_errors_return_a_generic_body_without_internals(client: TestClient, auth_engine) -> None:
    def broken_db():
        raise RuntimeError("secret-internal-detail postgresql://user:hunter2@db.internal/app")
        yield  # pragma: no cover

    client.app.dependency_overrides[get_db] = broken_db
    with TestClient(client.app, raise_server_exceptions=False) as tolerant_client:
        response = tolerant_client.get("/api/v1/products")
    assert response.status_code == 500
    for leaked in ("secret-internal-detail", "hunter2", "Traceback", "RuntimeError", "postgresql://", ".py"):
        assert leaked not in response.text, leaked


@pytest.mark.database
def test_logs_never_contain_passwords_or_tokens(client: TestClient, auth_engine, caplog: pytest.LogCaptureFixture) -> None:
    email, password = create_user(auth_engine)
    caplog.set_level(logging.DEBUG)

    assert client.post("/api/v1/auth/login", json={"email": email, "password": "Wrong-Password-123!"}).status_code == 401
    login(client, email, password)
    secrets = [
        password,
        "Wrong-Password-123!",
        client.cookies.get(ACCESS_TOKEN_COOKIE),
        client.cookies.get(REFRESH_TOKEN_COOKIE),
        client.cookies.get(CSRF_TOKEN_COOKIE),
    ]
    assert client.get("/api/v1/auth/me", params={"token": "query-secret-value"}).status_code == 200
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 204
    secrets += [client.cookies.get(ACCESS_TOKEN_COOKIE), client.cookies.get(REFRESH_TOKEN_COOKIE)]
    assert client.post("/api/v1/auth/logout", headers=csrf_headers(client)).status_code == 204

    # Only the application's own loggers: the test client (httpx) logs full URLs, which is not app behaviour.
    app_log = "\n".join(record.getMessage() for record in caplog.records if record.name.startswith("app"))
    assert "Request completed" in app_log, "expected the request log to be captured"
    for secret in secrets + ["query-secret-value"]:
        assert secret and secret not in app_log


@pytest.mark.database
def test_validation_errors_do_not_echo_submitted_values(client: TestClient, auth_engine) -> None:
    password = "Sup3r-Secret-Pw!"
    missing_email = client.post("/api/v1/auth/login", json={"password": password})
    wrong_type = client.post("/api/v1/auth/login", json={"email": ["x"], "password": password})

    for response in (missing_email, wrong_type):
        assert response.status_code == 422
        assert password not in response.text
        assert all("input" not in issue for issue in response.json()["detail"])
        assert all({"loc", "msg", "type"} <= set(issue) for issue in response.json()["detail"])  # clients still get field names
