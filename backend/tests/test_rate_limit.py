from concurrent.futures import ThreadPoolExecutor
import time
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from redis import Redis

from app.core.cache import get_redis
from app.core.config import get_settings
from app.core.rate_limit import RATE_LIMIT_NAMESPACE, enforce_limit
from app.models import UserRole
from test_auth import auth_database_url, auth_engine, auth_redis, client, create_user, csrf_headers, login


@pytest.mark.database
def test_login_limit_returns_429_retry_after_and_hides_account_identifier(
    client: TestClient, auth_engine, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    email, password = create_user(auth_engine)
    with monkeypatch.context() as environment:
        environment.setenv("RATE_LIMIT_LOGIN_PER_MINUTE", "2")
        get_settings.cache_clear()
        assert client.post("/api/v1/auth/login", json={"email": email, "password": "wrong"}).status_code == 401
        assert client.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code == 200
        limited = client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert limited.status_code == 429
        assert limited.json() == {"detail": "Too many requests. Please try again later."}
        assert int(limited.headers["retry-after"]) > 0
        keys = list(auth_redis.scan_iter(match=f"{RATE_LIMIT_NAMESPACE}:login-account:*"))
        assert len(keys) == 1 and email not in keys[0]
    get_settings.cache_clear()


@pytest.mark.database
def test_public_limit_is_atomic_and_spoofed_forwarded_for_is_ignored(
    client: TestClient, auth_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    with monkeypatch.context() as environment:
        environment.setenv("RATE_LIMIT_PUBLIC_SEARCH_PER_MINUTE", "3")
        get_settings.cache_clear()

        def search(forwarded_for: str) -> int:
            with TestClient(client.app) as concurrent_client:
                return concurrent_client.get(
                    "/api/v1/products?search=rate-limit",
                    headers={"X-Forwarded-For": forwarded_for},
                ).status_code

        with ThreadPoolExecutor(max_workers=5) as executor:
            statuses = list(executor.map(search, [f"203.0.113.{value}" for value in range(1, 6)]))
        assert statuses.count(200) == 3
        assert statuses.count(429) == 2
        key = next(auth_redis.scan_iter(match=f"{RATE_LIMIT_NAMESPACE}:public-search:*"))
        assert 0 < auth_redis.ttl(key) <= 60

        auth_redis.flushdb()
        environment.setenv("TRUSTED_PROXY_IPS", '["testclient"]')
        environment.setenv("RATE_LIMIT_PUBLIC_SEARCH_PER_MINUTE", "1")
        get_settings.cache_clear()
        assert client.get("/api/v1/products?search=rate-limit", headers={"X-Forwarded-For": "203.0.113.1"}).status_code == 200
        assert client.get("/api/v1/products?search=rate-limit", headers={"X-Forwarded-For": "203.0.113.2"}).status_code == 200
        assert client.get("/api/v1/products?search=rate-limit", headers={"X-Forwarded-For": "203.0.113.1"}).status_code == 429
    get_settings.cache_clear()


@pytest.mark.database
def test_user_mutation_limit_isolated_between_users(
    client: TestClient, auth_engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    first_email, first_password = create_user(auth_engine, role=UserRole.ADMIN)
    second_email, second_password = create_user(auth_engine, role=UserRole.ADMIN)
    with monkeypatch.context() as environment:
        environment.setenv("RATE_LIMIT_MUTATION_PER_MINUTE", "1")
        get_settings.cache_clear()
        login(client, first_email, first_password)
        assert client.post("/api/v1/categories", json={"name": f"Rate {uuid4().hex}"}, headers=csrf_headers(client)).status_code == 201
        assert client.post("/api/v1/categories", json={"name": f"Rate {uuid4().hex}"}, headers=csrf_headers(client)).status_code == 429
        with TestClient(client.app) as second_client:
            login(second_client, second_email, second_password)
            assert second_client.post(
                "/api/v1/categories", json={"name": f"Rate {uuid4().hex}"}, headers=csrf_headers(second_client)
            ).status_code == 201
    get_settings.cache_clear()


@pytest.mark.database
def test_limiter_window_expires_and_redis_failure_follows_policy(
    client: TestClient, auth_engine, auth_redis: Redis
) -> None:
    enforce_limit(auth_redis, scope="test", identity="window", limit=1, window_seconds=1, fail_closed=True)
    with pytest.raises(HTTPException, match="Too many requests") as limited:
        enforce_limit(auth_redis, scope="test", identity="window", limit=1, window_seconds=1, fail_closed=True)
    assert limited.value.status_code == 429
    time.sleep(1.1)
    enforce_limit(auth_redis, scope="test", identity="window", limit=1, window_seconds=1, fail_closed=True)

    email, password = create_user(auth_engine)
    client.app.dependency_overrides[get_redis] = lambda: None
    assert client.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code == 503
    assert client.get("/api/v1/products?search=rate-limit").status_code == 200


def test_security_headers_are_set(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
