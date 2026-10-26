import pytest

from app.core.config import Settings, validate_security_configuration


JWT = "jwt-test-secret-at-least-thirty-two-bytes-long"
CURSOR = "cursor-test-secret-at-least-thirty-two-bytes"
RATE_LIMIT = "rate-limit-test-secret-at-least-thirty-two-bytes"


def settings(**overrides: str | None) -> Settings:
    values = {"jwt_secret_key": JWT, "product_cursor_hmac_key": CURSOR, "rate_limit_key_secret": RATE_LIMIT}
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
