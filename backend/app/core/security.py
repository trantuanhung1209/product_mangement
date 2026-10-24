import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4

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
AUTH_USER_SESSIONS_NAMESPACE = "auth:user-sessions"
AUTH_ACCESS_BLACKLIST_NAMESPACE = "auth:blacklist:access"
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


def _user_sessions_key(user_id: int) -> str:
    return f"{AUTH_USER_SESSIONS_NAMESPACE}:{user_id}"


def _blacklist_key(jti: str) -> str:
    return f"{AUTH_ACCESS_BLACKLIST_NAMESPACE}:{jti}"


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
        {"sub": str(user.id), "sid": session_id, "jti": str(uuid4()), "iat": now, "exp": expires_at},
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


def create_session(user: User, redis: Redis | None, user_agent: str | None = None) -> tuple[str, str, str]:
    if redis is None:
        raise _unavailable()
    session_id, secret, refresh = _new_refresh()
    csrf = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    ttl = get_settings().jwt_refresh_token_expire_days * 86400
    data = json.dumps({
        "user_id": user.id, "refresh_hash": _hash(secret), "used_refresh_hashes": [], "csrf": csrf,
        "created_at": now.isoformat(), "last_active_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=ttl)).isoformat(), "user_agent": (user_agent or "Không xác định")[:255],
    })
    try:
        with redis.pipeline() as pipe:
            pipe.set(_key(session_id), data, ex=ttl, nx=True)
            pipe.sadd(_user_sessions_key(user.id), session_id)
            pipe.expire(_user_sessions_key(user.id), ttl)
            created, _, _ = pipe.execute()
        if not created:
            raise _unavailable()
    except RedisError:
        raise _unavailable() from None
    return _access_token(user, session_id), refresh, csrf


def list_user_sessions(redis: Redis | None, user_id: int) -> list[dict[str, object]]:
    if redis is None:
        raise _unavailable()
    index_key = _user_sessions_key(user_id)
    try:
        session_ids = redis.smembers(index_key)
        sessions: list[dict[str, object]] = []
        stale_ids: list[str] = []
        for session_id in session_ids:
            raw = redis.get(_key(session_id))
            if not raw:
                stale_ids.append(session_id)
                continue
            session = json.loads(raw)
            if session.get("user_id") != user_id:
                stale_ids.append(session_id)
                continue
            session["session_id"] = session_id
            sessions.append(session)
        if stale_ids:
            redis.srem(index_key, *stale_ids)
        return sessions
    except RedisError:
        raise _unavailable() from None


def revoke_user_session(redis: Redis | None, user_id: int, session_id: str) -> bool:
    if redis is None:
        raise _unavailable()
    key = _key(session_id)
    index_key = _user_sessions_key(user_id)
    for _ in range(2):
        try:
            with redis.pipeline() as pipe:
                pipe.watch(key)
                raw = pipe.get(key)
                if not raw or json.loads(raw).get("user_id") != user_id:
                    pipe.unwatch()
                    return False
                pipe.multi()
                pipe.delete(key)
                pipe.srem(index_key, session_id)
                pipe.execute()
            return True
        except WatchError:
            continue
        except RedisError:
            raise _unavailable() from None
    return False


def revoke_other_user_sessions(redis: Redis | None, user_id: int, current_session_id: str) -> int:
    revoked = 0
    for session in list_user_sessions(redis, user_id):
        session_id = str(session["session_id"])
        if session_id != current_session_id and revoke_user_session(redis, user_id, session_id):
            revoked += 1
    return revoked


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


def _access_claims(token: str) -> dict[str, object]:
    try:
        claims = jwt.decode(
            token,
            _secret(),
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "sub", "sid", "jti"]},
        )
        if not str(claims["sub"]) or not str(claims["sid"]):
            raise ValueError
        UUID(str(claims["jti"]))
        return claims
    except (ExpiredSignatureError, InvalidTokenError, KeyError, TypeError, ValueError):
        raise _unauthorized() from None


def _verified_access_claims(token: str, redis: Redis | None) -> dict[str, object]:
    claims = _access_claims(token)
    if redis is None:
        raise _unavailable()
    try:
        if redis.exists(_blacklist_key(str(claims["jti"]))):
            raise _unauthorized()
    except RedisError:
        raise _unavailable() from None
    return claims


def blacklist_access_token(token: str | None, redis: Redis | None) -> None:
    if not token:
        raise _unauthorized()
    claims = _verified_access_claims(token, redis)
    expires_at = float(claims["exp"])
    ttl = int(expires_at - datetime.now(UTC).timestamp())
    if ttl <= 0:
        raise _unauthorized()
    try:
        redis.set(_blacklist_key(str(claims["jti"])), "1", ex=ttl)
    except RedisError:
        raise _unavailable() from None


def get_current_session_id(
    token: Annotated[str | None, Depends(access_token_cookie)],
    redis: Redis | None = Depends(get_redis),
) -> str:
    if not token:
        raise _unauthorized()
    return str(_verified_access_claims(token, redis)["sid"])


def get_current_user(
    token: Annotated[str | None, Depends(access_token_cookie)],
    db: Session = Depends(get_db),
    redis: Redis | None = Depends(get_redis),
) -> User:
    if not token:
        raise _unauthorized()
    try:
        claims = _verified_access_claims(token, redis)
        session = _get_session(redis, claims["sid"])
        user_id = int(claims["sub"])
    except (KeyError, TypeError, ValueError):
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
        claims = _verified_access_claims(token, redis)
        session = _get_session(redis, claims["sid"])
    except (KeyError, TypeError, ValueError):
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
                session["last_active_at"] = datetime.now(UTC).isoformat()
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
        raw = redis.get(_key(session_id))
        if raw:
            revoke_user_session(redis, int(json.loads(raw)["user_id"]), str(session_id))
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
