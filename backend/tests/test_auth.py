from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO
import os
from pathlib import Path
import time
from uuid import uuid4

import jwt
import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from fastapi.testclient import TestClient
from minio import Minio
from PIL import Image
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.config import get_settings
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    AUTH_ACCESS_BLACKLIST_NAMESPACE,
    AUTH_SESSION_NAMESPACE,
    CSRF_TOKEN_COOKIE,
    JWT_ALGORITHM,
    REFRESH_TOKEN_COOKIE,
    hash_password,
)
from app.db.database import get_db
from app.main import create_app
from app.models import Category, ImageCleanupTask, Product, User, UserRole
from app.services.image import get_image, run_image_cleanup


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SECRET = "phase-08-test-secret-must-be-at-least-thirty-two-bytes"
CURSOR_SECRET = "phase-13-cursor-test-secret-at-least-thirty-two-bytes"
RATE_LIMIT_SECRET = "phase-12-rate-limit-test-secret-at-least-thirty-two-bytes"
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
    monkeypatch.setenv("PRODUCT_CURSOR_HMAC_KEY", CURSOR_SECRET)
    monkeypatch.setenv("RATE_LIMIT_KEY_SECRET", RATE_LIMIT_SECRET)
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


def access_cookie(response) -> str:
    value = response.cookies.get(ACCESS_TOKEN_COOKIE)
    assert value is not None
    return value


def image_bytes(format: str, mode: str = "RGB") -> bytes:
    image = Image.new(mode, (40, 20), (20, 40, 60, 120) if mode == "RGBA" else (20, 40, 60))
    output = BytesIO()
    image.save(output, format=format)
    return output.getvalue()


def require_minio() -> None:
    settings = get_settings()
    if not all((settings.minio_endpoint, settings.minio_access_key, settings.minio_secret_key)):
        pytest.skip("MinIO configuration is required for image integration tests.")
    try:
        Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        ).list_buckets()
    except Exception as error:
        pytest.skip(f"MinIO is unavailable for image integration tests: {type(error).__name__}")


def create_product(engine) -> int:
    with Session(engine) as session:
        category = Category(name=f"Images-{uuid4().hex}")
        session.add(category)
        session.flush()
        product = Product(name="Image integration", price=Decimal("1.00"), stock=1, category_id=category.id)
        session.add(product)
        session.commit()
        return product.id


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
def test_access_token_blacklist_refresh_and_session_revocation(client: TestClient, auth_engine, auth_redis: Redis) -> None:
    email, password = create_user(auth_engine)
    access_one = access_cookie(login(client, email, password))
    claims_one = jwt.decode(access_one, SECRET, algorithms=[JWT_ALGORITHM])
    assert claims_one["jti"]
    session_key = f"{AUTH_SESSION_NAMESPACE}:{claims_one['sid']}"

    with TestClient(client.app) as second_client:
        login(second_client, email, password)
        assert second_client.get("/api/v1/auth/me").status_code == 200

        assert client.post("/api/v1/auth/revoke-access", headers=csrf_headers(client)).status_code == 204
        blacklist_key = f"{AUTH_ACCESS_BLACKLIST_NAMESPACE}:{claims_one['jti']}"
        assert 0 < auth_redis.ttl(blacklist_key) <= int(claims_one["exp"] - datetime.now(UTC).timestamp()) + 1
        assert auth_redis.get(session_key) is not None
        assert client.get("/api/v1/auth/me").status_code == 401
        assert second_client.get("/api/v1/auth/me").status_code == 200

    refreshed = client.post("/api/v1/auth/refresh", headers=csrf_headers(client))
    assert refreshed.status_code == 204
    access_two = access_cookie(refreshed)
    claims_two = jwt.decode(access_two, SECRET, algorithms=[JWT_ALGORITHM])
    assert claims_two["jti"] != claims_one["jti"]
    assert client.get("/api/v1/auth/me").status_code == 200

    client.cookies.set(ACCESS_TOKEN_COOKIE, access_one, path="/")
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.set(ACCESS_TOKEN_COOKIE, access_two, path="/")
    assert client.post("/api/v1/auth/logout", headers=csrf_headers(client)).status_code == 204
    client.cookies.set(ACCESS_TOKEN_COOKIE, access_two, path="/")
    assert client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.database
def test_revoke_access_requires_csrf_origin_and_current_token_only(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    login(client, email, password)
    assert client.post("/api/v1/auth/revoke-access").status_code == 403
    assert client.post("/api/v1/auth/revoke-access", headers={CSRF_HEADER: "wrong"}).status_code == 403
    assert client.post(
        "/api/v1/auth/revoke-access",
        headers={**csrf_headers(client), "Origin": "http://evil.example"},
    ).status_code == 403
    assert client.post("/api/v1/auth/revoke-access", json={"jti": "someone-else"}, headers=csrf_headers(client)).status_code == 204


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
    access = access_cookie(login_response)
    session_id = jwt.decode(access, SECRET, algorithms=[JWT_ALGORITHM])["sid"]
    legacy = jwt.encode({"sub": "1", "sid": session_id, "exp": datetime.now(UTC) + timedelta(minutes=1)}, SECRET, algorithm=JWT_ALGORITHM)
    client.cookies.set(ACCESS_TOKEN_COOKIE, legacy, path="/")
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.set(ACCESS_TOKEN_COOKIE, access, path="/")
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
    assert client.post("/api/v1/auth/revoke-access", headers=csrf_headers(client)).status_code == 503
    assert client.post("/api/v1/auth/login", json={"email": admin_email, "password": admin_password}).status_code == 503


@pytest.mark.database
def test_session_management_user_ownership_and_admin(client: TestClient, auth_engine, auth_redis: Redis) -> None:
    email, password = create_user(auth_engine)
    login(client, email, password)
    with TestClient(client.app) as second_client:
        login(second_client, email, password)
        sessions = client.get("/api/v1/auth/sessions")
        assert sessions.status_code == 200
        items = sessions.json()
        assert len(items) == 2
        current = next(item for item in items if item["is_current"])
        other = next(item for item in items if not item["is_current"])
        assert "refresh_hash" not in current and "csrf" not in current
        assert client.delete(f"/api/v1/auth/sessions/{other['session_id']}", headers=csrf_headers(client)).status_code == 204
        assert second_client.get("/api/v1/auth/me").status_code == 401
        assert client.get("/api/v1/auth/me").status_code == 200

    victim_email, victim_password = create_user(auth_engine)
    with TestClient(client.app) as victim_client:
        login(victim_client, victim_email, victim_password)
        victim_session = victim_client.get("/api/v1/auth/sessions").json()[0]["session_id"]
    assert client.delete(f"/api/v1/auth/sessions/{victim_session}", headers=csrf_headers(client)).status_code == 404

    admin_email, admin_password = create_user(auth_engine, role=UserRole.ADMIN)
    with TestClient(client.app) as admin_client:
        login(admin_client, admin_email, admin_password)
        users = admin_client.get("/api/v1/admin/users", params={"search": victim_email})
        assert users.status_code == 200 and users.json()["total"] == 1
        victim_id = users.json()["items"][0]["id"]
        listed = admin_client.get(f"/api/v1/admin/users/{victim_id}/sessions")
        assert listed.status_code == 200 and listed.json()["active_session_count"] == 1
        assert admin_client.delete(
            f"/api/v1/admin/users/{victim_id}/sessions/{victim_session}", headers=csrf_headers(admin_client)
        ).status_code == 204
    assert auth_redis.get(f"{AUTH_SESSION_NAMESPACE}:{victim_session}") is None


@pytest.mark.database
def test_admin_image_lifecycle_rbac_and_csrf_with_real_minio(client: TestClient, auth_engine) -> None:
    require_minio()
    product_id = create_product(auth_engine)
    endpoint = f"/api/v1/products/{product_id}/image"

    assert client.post(endpoint, files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}).status_code == 401
    user_email, user_password = create_user(auth_engine)
    with TestClient(client.app) as user_client:
        login(user_client, user_email, user_password)
        assert user_client.post(endpoint, headers=csrf_headers(user_client), files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}).status_code == 403

    admin_email, admin_password = create_user(auth_engine, role=UserRole.ADMIN)
    login(client, admin_email, admin_password)
    assert client.post(endpoint, files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}).status_code == 403
    assert client.post(endpoint, headers={CSRF_HEADER: "wrong"}, files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}).status_code == 403
    assert client.post(endpoint, headers={**csrf_headers(client), "Origin": "http://evil.example"}, files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}).status_code == 403

    first = client.post(endpoint, headers=csrf_headers(client), files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")})
    assert first.status_code == 200
    with Session(auth_engine) as session:
        product = session.get(Product, product_id)
        assert product is not None
        first_key = product.image_object_key
        assert (product.image_width, product.image_height) == (40, 20)
    proxy = client.get(first.json()["image_url"])
    assert proxy.status_code == 200 and proxy.headers["content-type"] == "image/webp"
    with Image.open(BytesIO(proxy.content)) as output:
        assert output.format == "WEBP"

    replacement = client.post(endpoint, headers=csrf_headers(client), files={"file": ("image.png", image_bytes("PNG", "RGBA"), "image/png")})
    assert replacement.status_code == 200
    with Session(auth_engine) as session:
        product = session.get(Product, product_id)
        assert product is not None and product.image_object_key != first_key
        replacement_key = product.image_object_key
    with pytest.raises(HTTPException, match="Image not found"):
        get_image(str(first_key))

    webp = client.post(endpoint, headers=csrf_headers(client), files={"file": ("image.webp", image_bytes("WEBP"), "image/webp")})
    assert webp.status_code == 200
    with Session(auth_engine) as session:
        product = session.get(Product, product_id)
        assert product is not None and product.image_object_key != replacement_key
        webp_key = product.image_object_key
    with pytest.raises(HTTPException, match="Image not found"):
        get_image(str(replacement_key))

    assert client.delete(endpoint, headers=csrf_headers(client)).status_code == 204
    assert client.get(endpoint).status_code == 404
    with pytest.raises(HTTPException, match="Image not found"):
        get_image(str(webp_key))


@pytest.mark.database
def test_minio_failure_returns_503_and_defers_delete_cleanup(client: TestClient, auth_engine, monkeypatch) -> None:
    require_minio()
    product_id = create_product(auth_engine)
    endpoint = f"/api/v1/products/{product_id}/image"
    admin_email, admin_password = create_user(auth_engine, role=UserRole.ADMIN)
    login(client, admin_email, admin_password)
    assert client.post(endpoint, headers=csrf_headers(client), files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}).status_code == 200
    with Session(auth_engine) as session:
        key = session.get(Product, product_id).image_object_key

    monkeypatch.setenv("MINIO_ENDPOINT", "127.0.0.1:1")
    get_settings.cache_clear()
    assert client.post(endpoint, headers=csrf_headers(client), files={"file": ("image.jpg", image_bytes("JPEG"), "image/jpeg")}).status_code == 503
    assert client.delete(endpoint, headers=csrf_headers(client)).status_code == 204
    with Session(auth_engine) as session:
        assert session.get(Product, product_id).image_object_key is None
        assert session.query(ImageCleanupTask).filter_by(object_key=key).count() == 1

    monkeypatch.delenv("MINIO_ENDPOINT")
    get_settings.cache_clear()
    with Session(auth_engine) as session:
        assert run_image_cleanup(session) == (1, 0)
    with pytest.raises(HTTPException, match="Image not found"):
        get_image(str(key))
