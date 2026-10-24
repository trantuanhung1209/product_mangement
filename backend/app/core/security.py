import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyCookie
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from pwdlib import PasswordHash
from redis import Redis
from redis.exceptions import RedisError, WatchError
from sqlalchemy.orm import Session

from app.core.cache import get_redis
from app.core.config import get_settings
from app.db.database import get_db
from app.models import User, UserRole


ACCESS_TOKEN_COOKIE = "access_token"
REFRESH_TOKEN_COOKIE = "refresh_token"
CSRF_TOKEN_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"
JWT_ALGORITHM = "HS256"
AUTH_SESSION_NAMESPACE = "auth:session"
password_hash = PasswordHash.recommended()
access_token_cookie = APIKeyCookie(name=ACCESS_TOKEN_COOKIE, auto_error=False)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, password_hash_value: str) -> bool:
    return password_hash.verify(password, password_hash_value)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _key(session_id: str) -> str:
    return f"{AUTH_SESSION_NAMESPACE}:{session_id}"


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Authentication required.")


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="Authentication session store unavailable.")


def _secret() -> str:
    value = get_settings().jwt_secret_key
    if not value:
        raise RuntimeError("JWT_SECRET_KEY must be configured before using authentication.")
    return value


def _access_token(user: User, session_id: str) -> str:
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=get_settings().jwt_access_token_expire_minutes)
    return jwt.encode(
        {"sub": str(user.id), "sid": session_id, "iat": now, "exp": expires_at},
        _secret(),
        algorithm=JWT_ALGORITHM,
    )


def _parse_refresh(token: str) -> tuple[str, str]:
    try:
        session_id, secret = token.split(".", 1)
    except ValueError:
        raise _unauthorized() from None
    if not session_id or not secret:
        raise _unauthorized()
    return session_id, secret


def _new_refresh() -> tuple[str, str, str]:
    session_id = secrets.token_urlsafe(24)
    secret = secrets.token_urlsafe(32)
    return session_id, secret, f"{session_id}.{secret}"


def _origin_allowed(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and origin not in get_settings().cors_origins:
        raise HTTPException(status_code=403, detail="Origin is not allowed.")


def create_session(user: User, redis: Redis | None) -> tuple[str, str, str]:
    if redis is None:
        raise _unavailable()
    session_id, secret, refresh = _new_refresh()
    csrf = secrets.token_urlsafe(32)
    data = json.dumps(
        {"user_id": user.id, "refresh_hash": _hash(secret), "used_refresh_hashes": [], "csrf": csrf}
    )
    try:
        if not redis.set(_key(session_id), data, ex=get_settings().jwt_refresh_token_expire_days * 86400, nx=True):
            raise _unavailable()
    except RedisError:
        raise _unavailable() from None
    return _access_token(user, session_id), refresh, csrf


def _get_session(redis: Redis | None, session_id: str) -> dict[str, object]:
    if redis is None:
        raise _unavailable()
    try:
        value = redis.get(_key(session_id))
    except RedisError:
        raise _unavailable() from None
    if not value:
        raise _unauthorized()
    return json.loads(value)


def get_current_user(
    token: Annotated[str | None, Depends(access_token_cookie)],
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> User:
    if not token:
        raise _unauthorized()
    try:
        claims = jwt.decode(
            token,
            _secret(),
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "sub", "sid"]},
        )
        session = _get_session(redis, claims["sid"])
        user_id = int(claims["sub"])
    except (ExpiredSignatureError, InvalidTokenError, KeyError, TypeError, ValueError):
        raise _unauthorized() from None
    if session["user_id"] != user_id:
        raise _unauthorized()
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    return user


def require_csrf(
    request: Request,
    token: Annotated[str | None, Depends(access_token_cookie)],
    redis: Redis | None = Depends(get_redis),
) -> None:
    _origin_allowed(request)
    if not token:
        raise _unauthorized()
    try:
        claims = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
        session = _get_session(redis, claims["sid"])
    except (InvalidTokenError, KeyError, TypeError, ValueError):
        raise _unauthorized() from None
    header = request.headers.get(CSRF_HEADER)
    cookie = request.cookies.get(CSRF_TOKEN_COOKIE)
    if (
        not header
        or not cookie
        or not hmac.compare_digest(header, cookie)
        or not hmac.compare_digest(header, str(session["csrf"]))
    ):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")


def rotate_refresh(
    request: Request,
    refresh_token: str | None,
    redis: Redis | None,
) -> tuple[str, str, str, int]:
    _origin_allowed(request)
    if redis is None:
        raise _unavailable()
    if not refresh_token:
        raise _unauthorized()

    session_id, secret = _parse_refresh(refresh_token)
    key = _key(session_id)
    presented_hash = _hash(secret)
    try:
        with redis.pipeline() as pipe:
            pipe.watch(key)
            raw = pipe.get(key)
            if not raw:
                raise _unauthorized()
            session = json.loads(raw)
            header = request.headers.get(CSRF_HEADER)
            cookie = request.cookies.get(CSRF_TOKEN_COOKIE)
            if (
                not header
                or not cookie
                or not hmac.compare_digest(header, cookie)
                or not hmac.compare_digest(header, str(session["csrf"]))
            ):
                raise HTTPException(status_code=403, detail="CSRF validation failed.")

            if hmac.compare_digest(presented_hash, str(session["refresh_hash"])):
                new_secret = secrets.token_urlsafe(32)
                new_refresh = f"{session_id}.{new_secret}"
                ttl = redis.ttl(key)
                if ttl <= 0:
                    raise _unauthorized()
                used_hashes = list(session.get("used_refresh_hashes", []))
                used_hashes.append(presented_hash)
                session["used_refresh_hashes"] = used_hashes
                session["refresh_hash"] = _hash(new_secret)
                pipe.multi()
                pipe.set(key, json.dumps(session), ex=ttl)
                pipe.execute()
                return session_id, new_refresh, str(session["csrf"]), int(session["user_id"])

            if any(hmac.compare_digest(presented_hash, used_hash) for used_hash in session.get("used_refresh_hashes", [])):
                # A rotated token was replayed: revoke this session family.
                pipe.multi()
                pipe.delete(key)
                pipe.execute()
            raise _unauthorized()
    except WatchError:
        # A parallel refresh used the same token; treat it as replay and revoke the session.
        try:
            redis.delete(key)
        except RedisError:
            raise _unavailable() from None
        raise _unauthorized() from None
    except RedisError:
        raise _unavailable() from None


def revoke_session(token: str | None, redis: Redis | None) -> None:
    if redis is None:
        raise _unavailable()
    if not token:
        raise _unauthorized()
    try:
        session_id = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])["sid"]
        redis.delete(_key(session_id))
    except (InvalidTokenError, KeyError):
        raise _unauthorized() from None
    except RedisError:
        raise _unavailable() from None


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role is not UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin role required.")
    return current_user


def require_admin_with_csrf(
    current_user: User = Depends(require_admin),
    _: None = Depends(require_csrf),
) -> User:
    return current_user
