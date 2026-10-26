import re

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.auth import EMAIL_PATTERN
from app.schemas.password_rules import PASSWORD_MAX_LENGTH, require_strong_password


OTP_PATTERN = re.compile(r"^[0-9]{6}$")


def _email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise PydanticCustomError("invalid_email", "Email không hợp lệ.")
    return email


class _Strict(BaseModel):
    # extra="forbid": a client cannot smuggle role, is_active or any other user field.
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(_Strict):
    email: str = Field(max_length=255)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)

    @field_validator("email")
    @classmethod
    def email_must_be_valid(cls, value: str) -> str:
        return _email(value)

    @field_validator("password")
    @classmethod
    def password_must_be_strong(cls, value: str) -> str:
        return require_strong_password(value)


class ResendOtpRequest(_Strict):
    email: str = Field(max_length=255)

    @field_validator("email")
    @classmethod
    def email_must_be_valid(cls, value: str) -> str:
        return _email(value)


class VerifyOtpRequest(ResendOtpRequest):
    otp: str

    @field_validator("otp")
    @classmethod
    def otp_must_be_six_digits(cls, value: str) -> str:
        if not OTP_PATTERN.fullmatch(value):
            raise PydanticCustomError("invalid_otp", "Mã OTP gồm 6 chữ số.")
        return value


class RegistrationAccepted(BaseModel):
    message: str
    # Server-side settings, so the UI countdowns follow OTP_TTL_SECONDS / OTP_RESEND_COOLDOWN_SECONDS.
    expires_in_seconds: int
    resend_in_seconds: int
