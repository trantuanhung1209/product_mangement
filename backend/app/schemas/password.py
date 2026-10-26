from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.password_rules import PASSWORD_MAX_LENGTH, require_strong_password
from app.schemas.registration import ResendOtpRequest, VerifyOtpRequest


class ForgotPasswordRequest(ResendOtpRequest):
    pass


class ResetPasswordRequest(VerifyOtpRequest):
    new_password: str = Field(max_length=PASSWORD_MAX_LENGTH)

    @field_validator("new_password")
    @classmethod
    def new_password_must_be_strong(cls, value: str) -> str:
        return require_strong_password(value)


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Only compared against the stored hash, so no strength rule applies to the old password.
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(max_length=PASSWORD_MAX_LENGTH)

    @field_validator("new_password")
    @classmethod
    def new_password_must_be_strong(cls, value: str) -> str:
        return require_strong_password(value)
