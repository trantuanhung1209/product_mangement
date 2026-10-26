import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def security_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "default-test-jwt-secret-at-least-thirty-two-bytes")
    monkeypatch.setenv("PRODUCT_CURSOR_HMAC_KEY", "default-test-cursor-secret-at-least-thirty-two-bytes")
    monkeypatch.setenv("RATE_LIMIT_KEY_SECRET", "default-test-rate-limit-secret-at-least-thirty-two-bytes")
    get_settings.cache_clear()
