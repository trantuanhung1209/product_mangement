import os

import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def security_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "default-test-jwt-secret-at-least-thirty-two-bytes")
    monkeypatch.setenv("PRODUCT_CURSOR_HMAC_KEY", "default-test-cursor-secret-at-least-thirty-two-bytes")
    monkeypatch.setenv("RATE_LIMIT_KEY_SECRET", "default-test-rate-limit-secret-at-least-thirty-two-bytes")
    monkeypatch.setenv("OTP_HMAC_KEY", "default-test-otp-secret-at-least-thirty-two-bytes")
    # The developer's .env may hold a real Resend key and tuned values; tests must not see them.
    monkeypatch.setenv("RESEND_API_KEY", "")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("OTP_TTL_SECONDS", "300")
    monkeypatch.setenv("OTP_MAX_ATTEMPTS", "5")
    monkeypatch.setenv("OTP_RESEND_COOLDOWN_SECONDS", "60")
    monkeypatch.setenv("RATE_LIMIT_REGISTRATION_PER_MINUTE", "5")
    monkeypatch.setenv("RESEND_FROM_EMAIL", "noreply@uside.id.vn")
    # Backstop: no test may reach the real Resend API, whatever the environment says.
    import resend

    def no_network(_params):
        raise AssertionError("A test tried to send a real email through Resend.")

    monkeypatch.setattr(resend.Emails, "send", staticmethod(no_network))
    # MinIO integration tests must never write into the development bucket from .env.
    monkeypatch.setenv("MINIO_BUCKET", os.getenv("TEST_MINIO_BUCKET", "product-images-test"))
    get_settings.cache_clear()
