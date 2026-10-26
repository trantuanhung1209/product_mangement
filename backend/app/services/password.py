from fastapi import BackgroundTasks, HTTPException
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import otp_store as store
from app.core.config import get_settings
from app.core.email import EmailSender
from app.core.security import blacklist_access_token, hash_password, revoke_all_user_sessions, verify_password
from app.models import User
from app.services.otp_flow import (
    INVALID_OTP_MESSAGE, LOCKED_MESSAGE, AcceptedTimings, accepted, cooldown_or_429, deliver, require_sender,
)


PURPOSE = store.PASSWORD_RESET
SAME_PASSWORD_MESSAGE = "Mật khẩu mới phải khác mật khẩu hiện tại."
WRONG_CURRENT_MESSAGE = "Mật khẩu hiện tại không đúng."


def _locked_user(db: Session, user_id: int) -> User | None:
    # FOR UPDATE serialises concurrent resets/changes of the same account.
    return db.scalar(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    )


def forgot(
    db: Session, redis: Redis | None, sender: EmailSender, background: BackgroundTasks, email: str
) -> AcceptedTimings:
    require_sender(sender)
    cooldown_or_429(redis, email, PURPOSE)
    user = db.scalar(select(User).where(User.email == email))
    # Same answer either way: only an active account gets a code, nobody learns which emails exist.
    if user is not None and user.is_active:
        otp = store.generate_otp()
        store.save_pending(redis, email, "", otp, PURPOSE)
        ttl = get_settings().otp_ttl_seconds
        background.add_task(deliver, redis, email, PURPOSE, lambda: sender.send_password_reset(email, otp, ttl))
    return accepted()


def reset(db: Session, redis: Redis | None, email: str, otp: str, new_password: str) -> None:
    outcome = store.check_pending(redis, email, otp, PURPOSE)
    if outcome is store.VerifyOutcome.LOCKED:
        raise HTTPException(status_code=400, detail=LOCKED_MESSAGE)
    if outcome is not store.VerifyOutcome.OK:
        raise HTTPException(status_code=400, detail=INVALID_OTP_MESSAGE)
    # Only after the code is proven right may the response depend on the stored password; checking the
    # old password first would let anyone probe "is this the current password?" without a code.
    found = db.scalar(select(User.id).where(User.email == email))
    user = _locked_user(db, found) if found is not None else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail=INVALID_OTP_MESSAGE)
    if verify_password(new_password, user.password_hash):
        raise HTTPException(status_code=400, detail=SAME_PASSWORD_MESSAGE)  # the code stays valid
    if not store.consume_pending(redis, email, otp, PURPOSE):
        raise HTTPException(status_code=400, detail=INVALID_OTP_MESSAGE)  # a concurrent reset won
    user.password_hash = hash_password(new_password)
    db.flush()
    # If Redis fails here the request errors and the transaction rolls back: the password is unchanged.
    revoke_all_user_sessions(redis, user.id)
    db.commit()


def change(
    db: Session, redis: Redis | None, current_user: User, access_token: str | None, current_password: str, new_password: str
) -> None:
    user = _locked_user(db, current_user.id)
    if user is None or not user.is_active or not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=400, detail=WRONG_CURRENT_MESSAGE)
    if verify_password(new_password, user.password_hash):
        raise HTTPException(status_code=400, detail=SAME_PASSWORD_MESSAGE)
    user.password_hash = hash_password(new_password)
    db.flush()
    blacklist_access_token(access_token, redis)
    revoke_all_user_sessions(redis, user.id)
    db.commit()
