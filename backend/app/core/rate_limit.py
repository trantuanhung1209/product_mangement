import hashlib
import hmac
import logging
import time

from fastapi import Depends, HTTPException, Request
from redis import Redis
from redis.exceptions import RedisError

from app.core.cache import get_redis
from app.core.config import get_settings
from app.core.security import get_current_session_id, get_current_user
from app.models import User
from app.schemas.auth import LoginRequest
from app.schemas.password import ForgotPasswordRequest, ResetPasswordRequest
from app.schemas.registration import RegisterRequest, ResendOtpRequest, VerifyOtpRequest


logger = logging.getLogger("app.security")
RATE_LIMIT_NAMESPACE = "security:ratelimit"
_INCREMENT_WITH_TTL = """
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {value, redis.call('TTL', KEYS[1])}
"""


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="Rate limit service unavailable.")


def _identity(value: str) -> str:
    secret = get_settings().rate_limit_key_secret
    if not secret:
        raise _unavailable()
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client else "unknown"
    if direct_ip not in get_settings().trusted_proxy_ips:
        return direct_ip
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",", 1)[0].strip() or direct_ip


def _key(scope: str, identity: str, window_seconds: int) -> str:
    now = int(time.time())
    window = now // window_seconds
    return f"{RATE_LIMIT_NAMESPACE}:{scope}:{_identity(identity)}:{window}"


def enforce_limit(
    redis: Redis | None,
    *,
    scope: str,
    identity: str,
    limit: int,
    window_seconds: int = 60,
    fail_closed: bool,
) -> None:
    if redis is None:
        if fail_closed:
            raise _unavailable()
        logger.warning("Rate limiter unavailable; allowing public request")
        return
    key = _key(scope, identity, window_seconds)
    remaining_window = window_seconds - (int(time.time()) % window_seconds)
    try:
        count, ttl = redis.eval(_INCREMENT_WITH_TTL, 1, key, remaining_window)
    except RedisError:
        if fail_closed:
            raise _unavailable() from None
        logger.warning("Rate limiter unavailable; allowing public request")
        return
    if int(count) > limit:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(max(1, int(ttl)))},
        )


def limit_login(
    request: Request,
    payload: LoginRequest,
    redis: Redis | None = Depends(get_redis),
) -> None:
    settings = get_settings()
    enforce_limit(
        redis, scope="login-ip", identity=client_ip(request),
        limit=settings.rate_limit_login_per_minute, fail_closed=True,
    )
    enforce_limit(
        redis, scope="login-account", identity=payload.email.strip().lower(),
        limit=settings.rate_limit_login_per_minute, fail_closed=True,
    )


def _limit_registration(action: str, request: Request, email: str, redis: Redis | None) -> None:
    limit = get_settings().rate_limit_registration_per_minute
    enforce_limit(redis, scope=f"register-{action}-ip", identity=client_ip(request), limit=limit, fail_closed=True)
    enforce_limit(redis, scope=f"register-{action}-email", identity=email, limit=limit, fail_closed=True)


def limit_register_request(
    request: Request, payload: RegisterRequest, redis: Redis | None = Depends(get_redis)
) -> None:
    _limit_registration("request", request, payload.email, redis)


def limit_register_resend(
    request: Request, payload: ResendOtpRequest, redis: Redis | None = Depends(get_redis)
) -> None:
    _limit_registration("resend", request, payload.email, redis)


def limit_register_verify(
    request: Request, payload: VerifyOtpRequest, redis: Redis | None = Depends(get_redis)
) -> None:
    _limit_registration("verify", request, payload.email, redis)


def _limit_password(action: str, request: Request, email: str, redis: Redis | None) -> None:
    limit = get_settings().rate_limit_password_per_minute
    enforce_limit(redis, scope=f"password-{action}-ip", identity=client_ip(request), limit=limit, fail_closed=True)
    enforce_limit(redis, scope=f"password-{action}-email", identity=email, limit=limit, fail_closed=True)


def limit_password_forgot(
    request: Request, payload: ForgotPasswordRequest, redis: Redis | None = Depends(get_redis)
) -> None:
    _limit_password("forgot", request, payload.email, redis)


def limit_password_reset(
    request: Request, payload: ResetPasswordRequest, redis: Redis | None = Depends(get_redis)
) -> None:
    _limit_password("reset", request, payload.email, redis)


def limit_password_change(
    request: Request, current_user: User = Depends(get_current_user), redis: Redis | None = Depends(get_redis)
) -> None:
    # Changing a password verifies the old one, so a stolen session could use it as a guessing oracle.
    limit = get_settings().rate_limit_password_per_minute
    enforce_limit(redis, scope="password-change-user", identity=str(current_user.id), limit=limit, fail_closed=True)
    enforce_limit(redis, scope="password-change-ip", identity=client_ip(request), limit=limit, fail_closed=True)


def limit_refresh(request: Request, redis: Redis | None = Depends(get_redis)) -> None:
    enforce_limit(
        redis, scope="refresh-ip", identity=client_ip(request),
        limit=get_settings().rate_limit_refresh_per_minute, fail_closed=True,
    )


def limit_session_operation(
    session_id: str = Depends(get_current_session_id), redis: Redis | None = Depends(get_redis)
) -> None:
    enforce_limit(
        redis, scope="session", identity=session_id,
        limit=get_settings().rate_limit_session_per_minute, fail_closed=True,
    )


def limit_user_mutation(
    current_user: User = Depends(get_current_user), redis: Redis | None = Depends(get_redis)
) -> None:
    enforce_limit(
        redis, scope="user-mutation", identity=str(current_user.id),
        limit=get_settings().rate_limit_mutation_per_minute, fail_closed=True,
    )


def limit_image_upload(
    current_user: User = Depends(get_current_user), redis: Redis | None = Depends(get_redis)
) -> None:
    enforce_limit(
        redis, scope="image-upload", identity=str(current_user.id),
        limit=get_settings().rate_limit_image_upload_per_minute, fail_closed=True,
    )


def limit_public_search(request: Request, redis: Redis | None = Depends(get_redis)) -> None:
    if not request.query_params.get("search", "").strip():
        return
    enforce_limit(
        redis, scope="public-search", identity=client_ip(request),
        limit=get_settings().rate_limit_public_search_per_minute, fail_closed=False,
    )
