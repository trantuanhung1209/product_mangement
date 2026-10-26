import pytest

from app.core.config import Settings, validate_security_configuration


JWT = "jwt-test-secret-at-least-thirty-two-bytes-long"
CURSOR = "cursor-test-secret-at-least-thirty-two-bytes"
RATE_LIMIT = "rate-limit-test-secret-at-least-thirty-two-bytes"
OTP = "otp-test-secret-at-least-thirty-two-bytes-long"


def settings(**overrides: str | None) -> Settings:
    values = {"jwt_secret_key": JWT, "product_cursor_hmac_key": CURSOR, "rate_limit_key_secret": RATE_LIMIT, "otp_hmac_key": OTP}
    return Settings(_env_file=None, **{**values, **overrides})


def test_valid_distinct_secrets_pass() -> None:
    validate_security_configuration(settings())


@pytest.mark.parametrize("field", ["jwt_secret_key", "product_cursor_hmac_key", "rate_limit_key_secret"])
def test_missing_secret_fails_fast(field: str) -> None:
    with pytest.raises(RuntimeError, match=field.upper()):
        validate_security_configuration(settings(**{field: None}))


def test_short_secret_fails_fast() -> None:
    with pytest.raises(RuntimeError, match="PRODUCT_CURSOR_HMAC_KEY"):
        validate_security_configuration(settings(product_cursor_hmac_key="short"))


def test_otp_key_is_required_and_distinct() -> None:
    with pytest.raises(RuntimeError, match="OTP_HMAC_KEY"):
        validate_security_configuration(settings(otp_hmac_key=None))
    with pytest.raises(RuntimeError, match="distinct"):
        validate_security_configuration(settings(otp_hmac_key=JWT))


def test_shared_secret_is_rejected() -> None:
    with pytest.raises(RuntimeError, match="distinct"):
        validate_security_configuration(settings(rate_limit_key_secret=JWT))


@pytest.mark.parametrize(
    "placeholder",
    [
        "change_me_to_a_different_random_32_byte_secret",
        "REPLACE_ME_with_a_real_secret_value_here_123",
        "your_secret_here_your_secret_here_1234",
    ],
)
def test_placeholder_secret_is_rejected_without_leaking_value(placeholder: str) -> None:
    with pytest.raises(RuntimeError, match="RATE_LIMIT_KEY_SECRET") as error:
        validate_security_configuration(settings(rate_limit_key_secret=placeholder))
    assert placeholder not in str(error.value)


@pytest.mark.parametrize(
    "weak",
    [
        "a" * 40,
        "ab" * 20,
        "0123456789" * 4,
        "abcd" * 10,
    ],
)
def test_low_entropy_and_repeating_secrets_are_rejected_without_leaking_them(weak: str) -> None:
    with pytest.raises(RuntimeError, match="weak") as error:
        validate_security_configuration(settings(product_cursor_hmac_key=weak))
    assert "PRODUCT_CURSOR_HMAC_KEY" in str(error.value)
    assert weak not in str(error.value)


@pytest.mark.parametrize("strong", ["a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6", "Zx9-Qw3_Lm7Tk2Vb8Nc4Rd6Hf1Jp5Sy0"])
def test_ordinary_random_looking_secrets_are_accepted(strong: str) -> None:
    validate_security_configuration(settings(product_cursor_hmac_key=strong))


def test_random_hex_secrets_are_never_flagged_as_weak() -> None:
    import secrets

    for _ in range(2000):
        validate_security_configuration(
            settings(jwt_secret_key=secrets.token_hex(16), product_cursor_hmac_key=secrets.token_hex(16), rate_limit_key_secret=secrets.token_hex(16))
        )


def test_production_without_secure_cookies_warns(caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import create_app

    for name, value in {"JWT_SECRET_KEY": JWT, "PRODUCT_CURSOR_HMAC_KEY": CURSOR, "RATE_LIMIT_KEY_SECRET": RATE_LIMIT, "OTP_HMAC_KEY": OTP}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("REDIS_URL", raising=False)
    for env, secure, expected in [("production", "false", True), ("production", "true", False), ("development", "false", False)]:
        monkeypatch.setenv("APP_ENV", env)
        monkeypatch.setenv("JWT_COOKIE_SECURE", secure)
        get_settings.cache_clear()
        caplog.clear()
        caplog.set_level("WARNING", logger="app.cache")
        with TestClient(create_app()):
            pass
        assert ("JWT_COOKIE_SECURE is false" in caplog.text) is expected, (env, secure)
    get_settings.cache_clear()
