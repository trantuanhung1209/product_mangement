from collections.abc import Generator
from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
from uuid import uuid4

import jwt
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_COOKIE, JWT_ALGORITHM, hash_password
from app.db.database import get_db
from app.main import create_app
from app.models import User, UserRole


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SECRET = "phase-08-test-secret-must-be-at-least-thirty-two-bytes"


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
def client(auth_engine, monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
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


def login(client: TestClient, email: str, password: str) -> None:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200


@pytest.mark.database
def test_login_me_and_inactive_user(client: TestClient, auth_engine) -> None:
    email, password = create_user(auth_engine)
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "wrong"}).status_code == 401
    login_response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login_response.status_code == 200
    assert "httponly" in login_response.headers["set-cookie"].lower()
    assert client.get("/api/v1/auth/me").json()["email"] == email
    inactive_email, inactive_password = create_user(auth_engine, active=False)
    assert client.post("/api/v1/auth/login", json={"email": inactive_email, "password": inactive_password}).status_code == 401


@pytest.mark.database
def test_public_reads_rbac_csrf_and_invalid_tokens(client: TestClient, auth_engine) -> None:
    assert client.get("/api/v1/products").status_code == 200
    assert client.post("/api/v1/categories", json={"name": "anonymous"}).status_code == 401
    user_email, user_password = create_user(auth_engine)
    login(client, user_email, user_password)
    csrf = client.cookies.get("csrf_token")
    assert client.post("/api/v1/categories", json={"name": "user"}, headers={"X-CSRF-Token": csrf}).status_code == 403
    admin_email, admin_password = create_user(auth_engine, role=UserRole.ADMIN)
    login(client, admin_email, admin_password)
    assert client.post("/api/v1/categories", json={"name": f"admin-{uuid4().hex}"}, headers={"X-CSRF-Token": client.cookies.get("csrf_token")}).status_code == 201
    expired = jwt.encode({"sub": "1", "role": "ADMIN", "csrf": "x", "exp": datetime.now(UTC) - timedelta(minutes=1)}, SECRET, algorithm=JWT_ALGORITHM)
    client.cookies.set(ACCESS_TOKEN_COOKIE, expired)
    assert client.get("/api/v1/auth/me").status_code == 401
    wrong_signature = jwt.encode({"sub": "1", "role": "ADMIN", "csrf": "x", "exp": datetime.now(UTC) + timedelta(minutes=1)}, "wrong-signature-secret-must-be-at-least-32-bytes", algorithm=JWT_ALGORITHM)
    client.cookies.set(ACCESS_TOKEN_COOKIE, wrong_signature)
    assert client.get("/api/v1/auth/me").status_code == 401
