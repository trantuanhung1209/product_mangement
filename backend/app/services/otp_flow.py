from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException
from redis import Redis

from app.core import otp_store as store
from app.core.config import get_settings
from app.core.email import EmailDeliveryError, EmailSender


ACCEPTED_MESSAGE = "Nếu email hợp lệ, chúng tôi đã gửi hướng dẫn xác minh. Vui lòng kiểm tra hộp thư."
INVALID_OTP_MESSAGE = "Mã OTP không đúng hoặc đã hết hạn."
LOCKED_MESSAGE = "Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới."
EMAIL_FAILED_MESSAGE = "Không thể gửi email lúc này. Vui lòng thử lại sau."


@dataclass(frozen=True)
class AcceptedTimings:
    message: str
    expires_in_seconds: int
    resend_in_seconds: int


def accepted() -> AcceptedTimings:
    settings = get_settings()
    return AcceptedTimings(ACCEPTED_MESSAGE, settings.otp_ttl_seconds, settings.otp_resend_cooldown_seconds)


def require_sender(sender: EmailSender) -> None:
    # A missing Resend key is a deployment fault, the same for every email, so it can be reported.
    if not sender.is_configured:
        raise HTTPException(status_code=503, detail=EMAIL_FAILED_MESSAGE)


def cooldown_or_429(redis: Redis | None, email: str, purpose: str) -> None:
    wait = store.acquire_cooldown(redis, email, purpose)
    if wait:
        raise HTTPException(
            status_code=429,
            detail=f"Vui lòng đợi {wait} giây trước khi yêu cầu mã mới.",
            headers={"Retry-After": str(wait)},
        )


def deliver(redis: Redis | None, email: str, purpose: str, send: Callable[[], None]) -> None:
    # Runs after the response: every path answers in the same time whether or not a mail goes out.
    # A failed send must not leave a usable OTP or hold the user in the cooldown.
    try:
        send()
    except EmailDeliveryError:
        store.delete_pending(redis, email, purpose)
        store.release_cooldown(redis, email, purpose)
