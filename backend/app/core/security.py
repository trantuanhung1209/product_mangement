import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyCookie
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.database import get_db
from app.models import User, UserRole


ACCESS_TOKEN_COOKIE = "access_token"
CSRF_TOKEN_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"
JWT_ALGORITHM = "HS256"
password_hash = PasswordHash.recommended()
access_token_cookie = APIKeyCookie(name=ACCESS_TOKEN_COOKIE, auto_error=False)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, password_hash_value: str) -> bool:
    return password_hash.verify(password, password_hash_value)


def _jwt_secret() -> str:
    secret = get_settings().jwt_secret_key
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY must be configured before using authentication.")
    return secret


def create_access_token(user: User) -> tuple[str, str]:
    settings = get_settings()
    csrf_token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "csrf": csrf_token,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_token_expire_minutes),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM), csrf_token


def _credentials_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")


def get_current_user(
    token: Annotated[str | None, Depends(access_token_cookie)],
    db: Session = Depends(get_db),
) -> User:
    if token is None:
        raise _credentials_error()
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub", "role", "csrf"]})
        user_id = int(payload["sub"])
    except (ExpiredSignatureError, InvalidTokenError, KeyError, TypeError, ValueError):
        raise _credentials_error() from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _credentials_error()
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role is not UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required.")
    return current_user


def require_csrf(request: Request, current_user: User = Depends(get_current_user)) -> User:
    token = request.cookies.get(CSRF_TOKEN_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    try:
        payload = jwt.decode(request.cookies[ACCESS_TOKEN_COOKIE], _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except (KeyError, InvalidTokenError):
        raise _credentials_error() from None
    if not token or not header or not hmac.compare_digest(token, header) or not hmac.compare_digest(token, payload["csrf"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed.")
    return current_user


def require_admin_with_csrf(current_user: User = Depends(require_admin), _: User = Depends(require_csrf)) -> User:
    return current_user
