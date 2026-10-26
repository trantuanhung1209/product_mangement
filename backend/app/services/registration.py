from fastapi import BackgroundTasks, HTTPException
from redis import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import otp_store as store
from app.core.config import get_settings
from app.core.email import EmailSender
from app.core.security import hash_password
from app.models import User, UserRole
from app.services.otp_flow import (
    INVALID_OTP_MESSAGE, LOCKED_MESSAGE, AcceptedTimings, accepted, cooldown_or_429, deliver, require_sender,
)


REGISTER_FAILED_MESSAGE = "Không thể hoàn tất đăng ký. Vui lòng thử lại."
PURPOSE = store.REGISTRATION


def request_otp(
    db: Session, redis: Redis | None, sender: EmailSender, background: BackgroundTasks, email: str, password: str
) -> AcceptedTimings:
    require_sender(sender)
    cooldown_or_429(redis, email, PURPOSE)
    # Hash on every path so response time does not reveal whether the email is already registered.
    password_hash = hash_password(password)
    exists = db.scalar(select(User.id).where(User.email == email)) is not None
    if exists:
        background.add_task(deliver, redis, email, PURPOSE, lambda: sender.send_already_registered(email))
    else:
        otp = store.generate_otp()
        store.save_pending(redis, email, password_hash, otp)
        ttl = get_settings().otp_ttl_seconds
        background.add_task(deliver, redis, email, PURPOSE, lambda: sender.send_otp(email, otp, ttl))
    return accepted()


def resend_otp(redis: Redis | None, sender: EmailSender, background: BackgroundTasks, email: str) -> AcceptedTimings:
    require_sender(sender)
    cooldown_or_429(redis, email, PURPOSE)
    otp = store.generate_otp()
    if store.replace_otp(redis, email, otp):
        ttl = get_settings().otp_ttl_seconds
        background.add_task(deliver, redis, email, PURPOSE, lambda: sender.send_otp(email, otp, ttl))
    return accepted()


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
