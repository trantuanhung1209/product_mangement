from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
import time
from uuid import uuid4

import jwt
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.config import get_settings
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    AUTH_SESSION_NAMESPACE,
    CSRF_TOKEN_COOKIE,
    JWT_ALGORITHM,
    REFRESH_TOKEN_COOKIE,
    hash_password,
)
from app.db.database import get_db
from app.main import create_app
from app.models import User, UserRole


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SECRET = "phase-08-test-secret-must-be-at-least-thirty-two-bytes"
CSRF_HEADER = "X-CSRF-Token"


@pytest.fixture(scope="session")
def auth_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if url is None:
        pytest.skip("TEST_DATABASE_URL is required for auth integration tests.")
    return url


@pytest.fixture(scope="session")
def auth_engine(auth_database_url: str):
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", auth_database_url)
    command.upgrade(config, "head")
    engine = create_engine(auth_database_url)
    yield engine
    engine.dispose()


@pytest.fixture
def auth_redis() -> Generator[Redis, None, None]:
    url = os.getenv("TEST_REDIS_URL")
    if url is None:
        pytest.skip("TEST_REDIS_URL is required for auth integration tests.")
    redis = Redis.from_url(url, decode_responses=True)
    try:
        redis.ping()
    except RedisError:
        pytest.skip("TEST_REDIS_URL is unavailable for auth integration tests.")
    redis.flushdb()
    yield redis
    redis.flushdb()
    redis.close()


@pytest.fixture
def client(
    auth_engine,
    auth_redis: Redis,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)
    get_settings.cache_clear()
    app = create_app()

    def override_get_db() -> Generator[Session, None, None]:
        session = Session(auth_engine)
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_redis] = lambda: auth_redis
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_settings.cache_clear()


def create_user(engine, role: UserRole = UserRole.USER, active: bool = True) -> tuple[str, str]:
    email = f"{uuid4().hex}@example.com"
    password = "CorrectHorseBatteryStaple!"
    with Session(engine) as session:
        session.add(User(email=email, password_hash=hash_password(password), role=role, is_active=active))
        session.commit()
    return email, password


def login(client: TestClient, email: str, password: str):
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response


def csrf_headers(client: TestClient) -> dict[str, str]:
    return {CSRF_HEADER: client.cookies.get(CSRF_TOKEN_COOKIE)}


def refresh_headers(client: TestClient, refresh: str) -> dict[str, str]:
    csrf = client.cookies.get(CSRF_TOKEN_COOKIE)
    return {CSRF_HEADER: csrf, "Cookie": f"{REFRESH_TOKEN_COOKIE}={refresh}; {CSRF_TOKEN_COOKIE}={csrf}"}


def refresh_cookie(response) -> str:
    value = response.cookies.get(REFRESH_TOKEN_COOKIE)
    assert value is not None
    return value


@pytest.mark.database
def test_rotation_reuse_detection_and_ttl(client: TestClient, auth_engine, auth_redis: Redis) -> None:
    email, password = create_user(auth_engine)
    first_login = login(client, email, password)
    refresh_one = refresh_cookie(first_login)
    session_id = refresh_one.split(".", 1)[0]
    key = f"{AUTH_SESSION_NAMESPACE}:{session_id}"
    assert 0 < auth_redis.ttl(key) <= 7 * 86400

    first_refresh = client.post("/api/v1/auth/refresh", headers=csrf_headers(client))
    assert first_refresh.status_code == 204
    refresh_two = refresh_cookie(first_refresh)
    assert refresh_two != refresh_one

    second_refresh = client.post("/api/v1/auth/refresh", headers=refresh_headers(client, refresh_two))
    assert second_refresh.status_code == 204
    refresh_three = refresh_cookie(second_refresh)

    assert client.post("/api/v1/auth/refresh", headers=refresh_headers(client, refresh_one)).status_code == 401
    assert client.post("/api/v1/auth/refresh", headers=refresh_headers(client, refresh_three)).status_code == 401
    assert auth_redis.get(key) is None


@pytest.mark.database
def test_concurrent_refresh_allows_at_most_one_success(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    refresh_one = refresh_cookie(login(client, email, password))
    csrf = client.cookies.get(CSRF_TOKEN_COOKIE)

    def refresh_once() -> int:
        with TestClient(client.app) as concurrent_client:
            concurrent_client.cookies.set(REFRESH_TOKEN_COOKIE, refresh_one, path="/api/v1/auth/refresh")
            concurrent_client.cookies.set(CSRF_TOKEN_COOKIE, csrf, path="/")
            return concurrent_client.post("/api/v1/auth/refresh", headers={CSRF_HEADER: csrf}).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(lambda _: refresh_once(), range(2)))
    assert statuses.count(204) <= 1
    assert statuses.count(401) >= 1


@pytest.mark.database
def test_multiple_sessions_logout_and_csrf(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    login(client, email, password)
    with TestClient(client.app) as second_client:
        login(second_client, email, password)
        assert client.post("/api/v1/auth/logout").status_code == 403
        assert client.post("/api/v1/auth/logout", headers=csrf_headers(client)).status_code == 204
        assert client.get("/api/v1/auth/me").status_code == 401
        assert second_client.get("/api/v1/auth/me").status_code == 200
        assert second_client.post("/api/v1/auth/logout", headers={CSRF_HEADER: "wrong"}).status_code == 403
        assert second_client.post(
            "/api/v1/auth/logout",
            headers={**csrf_headers(second_client), "Origin": "http://evil.example"},
        ).status_code == 403


@pytest.mark.database
def test_refresh_requires_session_csrf_and_access_can_expire(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    login(client, email, password)
    assert client.post("/api/v1/auth/refresh").status_code == 403
    assert client.post("/api/v1/auth/refresh", headers={CSRF_HEADER: "wrong"}).status_code == 403
    client.cookies.set(ACCESS_TOKEN_COOKIE, "expired")
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 204


@pytest.mark.database
def test_expired_session_rejects_access(client: TestClient, auth_engine, auth_redis: Redis) -> None:
    email, password = create_user(auth_engine)
    refresh = refresh_cookie(login(client, email, password))
    assert auth_redis.expire(f"{AUTH_SESSION_NAMESPACE}:{refresh.split('.', 1)[0]}", 1)
    time.sleep(1.1)
    assert client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.database
def test_login_me_inactive_and_invalid_tokens(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "wrong"}).status_code == 401
    login_response = login(client, email, password)
    cookies = login_response.headers.get_list("set-cookie")
    assert any("access_token=" in cookie and "httponly" in cookie.lower() for cookie in cookies)
    assert any("refresh_token=" in cookie and "Path=/api/v1/auth/refresh" in cookie for cookie in cookies)
    assert client.get("/api/v1/auth/me").json()["email"] == email
    with Session(auth_engine) as session:
        user = session.query(User).filter_by(email=email).one()
        user.is_active = False
        session.commit()
    assert client.get("/api/v1/auth/me").status_code == 401
    expired = jwt.encode({"sub": "1", "sid": "x", "exp": datetime.now(UTC) - timedelta(minutes=1)}, SECRET, algorithm=JWT_ALGORITHM)
    client.cookies.set(ACCESS_TOKEN_COOKIE, expired)
    assert client.get("/api/v1/auth/me").status_code == 401
    wrong_signature = jwt.encode({"sub": "1", "sid": "x", "exp": datetime.now(UTC) + timedelta(minutes=1)}, "wrong-signature-secret-must-be-at-least-32-bytes", algorithm=JWT_ALGORITHM)
    client.cookies.set(ACCESS_TOKEN_COOKIE, wrong_signature)
    assert client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.database
def test_rbac_and_redis_fail_closed(client: TestClient, auth_engine) -> None:
    assert client.get("/api/v1/products").status_code == 200
    assert client.post("/api/v1/categories", json={"name": "anonymous"}).status_code == 401
    user_email, user_password = create_user(auth_engine)
    login(client, user_email, user_password)
    assert client.post("/api/v1/categories", json={"name": "user"}, headers=csrf_headers(client)).status_code == 403
    admin_email, admin_password = create_user(auth_engine, role=UserRole.ADMIN)
    login(client, admin_email, admin_password)
    assert client.post("/api/v1/categories", json={"name": f"admin-{uuid4().hex}"}, headers=csrf_headers(client)).status_code == 201
    client.app.dependency_overrides[get_redis] = lambda: None
    assert client.get("/api/v1/auth/me").status_code == 503
    assert client.post("/api/v1/auth/refresh", headers=csrf_headers(client)).status_code == 503
    assert client.post("/api/v1/auth/login", json={"email": admin_email, "password": admin_password}).status_code == 503
