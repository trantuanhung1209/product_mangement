import re

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.auth import EMAIL_PATTERN


PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
OTP_PATTERN = re.compile(r"^[0-9]{6}$")


def password_problems(password: str) -> list[str]:
    problems = []
    if len(password) < PASSWORD_MIN_LENGTH:
        problems.append(f"Mật khẩu phải có ít nhất {PASSWORD_MIN_LENGTH} ký tự.")
    if not any(ch.isupper() for ch in password):
        problems.append("Mật khẩu phải có ít nhất 1 chữ hoa.")
    if not any("0" <= ch <= "9" for ch in password):
        problems.append("Mật khẩu phải có ít nhất 1 chữ số.")
    if not any(not ch.isalnum() for ch in password):
        problems.append("Mật khẩu phải có ít nhất 1 ký tự đặc biệt.")
    return problems


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
        problems = password_problems(value)
        if problems:
            raise PydanticCustomError("weak_password", problems[0])
        return value


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
