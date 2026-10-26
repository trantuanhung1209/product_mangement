from collections.abc import Callable
from dataclasses import dataclass

from fastapi import BackgroundTasks, HTTPException
from redis import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import registration_store as store
from app.core.config import get_settings
from app.core.email import EmailDeliveryError, EmailSender
from app.core.security import hash_password
from app.models import User, UserRole


@dataclass(frozen=True)
class AcceptedTimings:
    message: str
    expires_in_seconds: int
    resend_in_seconds: int


ACCEPTED_MESSAGE = "Nếu email hợp lệ, chúng tôi đã gửi hướng dẫn xác minh. Vui lòng kiểm tra hộp thư."
INVALID_OTP_MESSAGE = "Mã OTP không đúng hoặc đã hết hạn."
LOCKED_MESSAGE = "Bạn đã nhập sai quá nhiều lần. Vui lòng yêu cầu mã mới."
REGISTER_FAILED_MESSAGE = "Không thể hoàn tất đăng ký. Vui lòng thử lại."
EMAIL_FAILED_MESSAGE = "Không thể gửi email lúc này. Vui lòng thử lại sau."


def _cooldown_or_429(redis: Redis | None, email: str) -> None:
    wait = store.acquire_cooldown(redis, email)
    if wait:
        raise HTTPException(
            status_code=429,
            detail=f"Vui lòng đợi {wait} giây trước khi yêu cầu mã mới.",
            headers={"Retry-After": str(wait)},
        )


def _require_sender(sender: EmailSender) -> None:
    # A missing Resend key is a deployment fault, the same for every email, so it can be reported.
    if not sender.is_configured:
        raise HTTPException(status_code=503, detail=EMAIL_FAILED_MESSAGE)


def _deliver(redis: Redis | None, email: str, send: Callable[[], None]) -> None:
    # Runs after the response: every path answers in the same time whether or not a mail goes out.
    # A failed send must not leave a usable OTP or hold the user in the cooldown.
    try:
        send()
    except EmailDeliveryError:
        store.delete_pending(redis, email)
        store.release_cooldown(redis, email)


def _accepted() -> AcceptedTimings:
    settings = get_settings()
    return AcceptedTimings(ACCEPTED_MESSAGE, settings.otp_ttl_seconds, settings.otp_resend_cooldown_seconds)


def request_otp(
    db: Session, redis: Redis | None, sender: EmailSender, background: BackgroundTasks, email: str, password: str
) -> AcceptedTimings:
    _require_sender(sender)
    _cooldown_or_429(redis, email)
    # Hash on every path so response time does not reveal whether the email is already registered.
    password_hash = hash_password(password)
    exists = db.scalar(select(User.id).where(User.email == email)) is not None
    if exists:
        background.add_task(_deliver, redis, email, lambda: sender.send_already_registered(email))
    else:
        otp = store.generate_otp()
        store.save_pending(redis, email, password_hash, otp)
        ttl = get_settings().otp_ttl_seconds
        background.add_task(_deliver, redis, email, lambda: sender.send_otp(email, otp, ttl))
    return _accepted()


def resend_otp(redis: Redis | None, sender: EmailSender, background: BackgroundTasks, email: str) -> AcceptedTimings:
    _require_sender(sender)
    _cooldown_or_429(redis, email)
    otp = store.generate_otp()
    if store.replace_otp(redis, email, otp):
        ttl = get_settings().otp_ttl_seconds
        background.add_task(_deliver, redis, email, lambda: sender.send_otp(email, otp, ttl))
    return _accepted()


def verify_otp(db: Session, redis: Redis | None, email: str, otp: str) -> User:
    result = store.verify_pending(redis, email, otp)
    if result.outcome is store.VerifyOutcome.LOCKED:
        raise HTTPException(status_code=400, detail=LOCKED_MESSAGE)
    if result.outcome is not store.VerifyOutcome.OK or result.password_hash is None:
        raise HTTPException(status_code=400, detail=INVALID_OTP_MESSAGE)
    # The role is fixed here; nothing from the request reaches it.
    user = User(email=email, password_hash=result.password_hash, role=UserRole.USER)
    try:
        db.add(user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=REGISTER_FAILED_MESSAGE) from None
    db.refresh(user)
    return user
